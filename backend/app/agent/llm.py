"""Gemini access behind a small interface, so the graph and services can be tested with a fake."""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any, Protocol, TypeVar

from google import genai
from google.genai import errors, types
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


AI_NOT_INCLUDED = "AI features aren't included in your account."


log = logging.getLogger("resumaker.llm")

# The graph node (or service call) a model call belongs to. Only read when usage is being recorded (the evals), so it costs nothing otherwise.
call_label: ContextVar[str] = ContextVar("llm_call_label", default="")


def _api_error(e: "errors.APIError") -> "LLMError":
    """Gemini's own message stays in the log (it can name the model, project or key state); the person sees a plain one."""
    log.warning("Gemini API error %s: %s", e.code, e.message)
    if e.code == 429:
        return LLMError("The AI service is busy right now. Please wait a minute and try again.", 429)
    return LLMError("The AI request failed. Please try again.", 502)


def _unreachable(e: Exception) -> "LLMError":
    log.warning("Gemini unreachable: %r", e)
    return LLMError("Could not reach the AI service. Please try again.")


class LLMError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class LLM(Protocol):
    """`fast=True` selects the cheaper model, for small decisions (routing, classification) where quality headroom is wasted."""

    async def text(self, *, system: str, prompt: str, temperature: float = 0.5, fast: bool = False) -> str: ...

    async def json(self, *, system: str, contents: list[dict[str, Any]], schema: type[T], temperature: float = 0.3, fast: bool = False) -> T: ...

    async def embed(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        """One vector per text. `query=True` for a search query, False for something being stored (the model treats them differently)."""
        ...


def _part(p: Any) -> types.Part:
    # A part is text, or {"mime": ..., "data": bytes} for a file (e.g. a PDF the model reads directly).
    return types.Part.from_bytes(data=p["data"], mime_type=p["mime"]) if isinstance(p, dict) else types.Part(text=p)


def _contents(items: list[dict[str, Any]]) -> list[types.Content]:
    return [types.Content(role=i["role"], parts=[_part(t) for t in i["parts"]]) for i in items]


class GeminiLLM:
    def __init__(self, api_key: str, model: str, fast_model: str | None = None, embedding_model: str = "gemini-embedding-001", dims: int = 768):
        self.embedding_model = embedding_model
        self.dims = dims
        self.model = model
        self.fast_model = fast_model or model
        self.usage: list[dict[str, Any]] | None = None  # set to a list to record the `usage_metadata` of every call (the evals do; see tests/evals/usage.py)
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=110_000, api_version="v1beta"))

    async def _generate(self, *, system: str, contents: Any, fast: bool = False, **config: Any) -> types.GenerateContentResponse:
        model = self.fast_model if fast else self.model

        async def go(thinking: bool) -> types.GenerateContentResponse:
            extra = {"thinking_config": types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)} if thinking else {}
            cfg = types.GenerateContentConfig(system_instruction=system, **config, **extra)
            resp = await self.client.aio.models.generate_content(model=model, contents=contents, config=cfg)
            self._record(model, resp.usage_metadata)
            return resp

        try:
            try:
                return await go(True)
            except errors.ClientError as e:
                # Some models reject a thinking level; retry without it.
                if "thinking" not in str(e).lower():
                    raise
                return await go(False)
        except errors.APIError as e:
            raise _api_error(e) from e
        except Exception as e:  # network, timeout…
            raise _unreachable(e) from e

    def _record(self, model: str, u: Any) -> None:
        if self.usage is not None and u is not None:
            # Thinking tokens are billed as output, so they are kept apart but counted in the cost.
            self.usage.append({"label": call_label.get(), "model": model, "input": u.prompt_token_count or 0, "output": u.candidates_token_count or 0, "thinking": u.thoughts_token_count or 0})

    async def count_tokens(self, text: str, *, fast: bool = False) -> int:
        """Tokens in `text` by Gemini's own counter (used to measure the fixed system prompts)."""
        res = await self.client.aio.models.count_tokens(model=self.fast_model if fast else self.model, contents=text)
        return res.total_tokens or 0

    @staticmethod
    def _check(resp: types.GenerateContentResponse) -> str:
        text = resp.text or ""
        if not text.strip():
            blocked = getattr(resp.prompt_feedback, "block_reason", None)
            raise LLMError("The AI’s safety filters blocked this request." if blocked else "The AI returned an empty answer.")
        return text

    async def text(self, *, system: str, prompt: str, temperature: float = 0.5, fast: bool = False) -> str:
        resp = await self._generate(system=system, contents=prompt, temperature=temperature, fast=fast)
        return self._check(resp)

    async def json(self, *, system: str, contents: list[dict[str, Any]], schema: type[T], temperature: float = 0.3, fast: bool = False) -> T:
        resp = await self._generate(
            system=system, contents=_contents(contents), temperature=temperature, fast=fast,
            response_mime_type="application/json", response_schema=schema,
        )
        raw = self._check(resp)
        try:
            return schema.model_validate_json(raw)
        except Exception as e:  # noqa: BLE001
            raise LLMError("The assistant returned an unreadable answer. Please try again.") from e

    async def embed(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        cfg = types.EmbedContentConfig(task_type="RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT", output_dimensionality=self.dims)
        try:
            res = await self.client.aio.models.embed_content(model=self.embedding_model, contents=texts, config=cfg)
        except errors.APIError as e:
            raise _api_error(e) from e
        except Exception as e:  # noqa: BLE001
            raise _unreachable(e) from e
        if self.usage is not None:  # the embedding API reports no usage, so the input is counted separately
            try:
                n = (await self.client.aio.models.count_tokens(model=self.embedding_model, contents=texts)).total_tokens or 0
            except Exception:  # noqa: BLE001 - a measurement must never break the call
                n = 0
            self.usage.append({"label": call_label.get(), "model": self.embedding_model, "input": n, "output": 0, "thinking": 0})
        vectors = [list(e.values or []) for e in (res.embeddings or [])]
        if len(vectors) != len(texts) or any(len(v) != self.dims for v in vectors):
            raise LLMError("The AI returned an unexpected answer.")
        return vectors
