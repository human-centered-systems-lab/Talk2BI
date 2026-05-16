from typing import Any, AsyncGenerator, Dict, List

import json

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from agent.agent import graph_runnable
from utils.chat_db import log_message, get_messages, get_recent_sessions_for_user


app = FastAPI(title="Talk2BI Backend", version="0.1.0")


@app.get("/health")
async def health() -> Dict[str, str]:
    """Simple health check endpoint.

    Useful for verifying that the FastAPI application is running.
    """

    return {"status": "ok"}


@app.post("/chat/stream")
async def chat_stream(payload: Dict[str, Any]) -> StreamingResponse:
    """Stream LangGraph events from the Talk2BI agent.

    This endpoint expects a JSON body with at least a ``messages`` key,
    and optionally a ``session_id`` key used to distinguish chat sessions:

    ```json
    {
      "messages": [
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
      ],
      "session_id": "..."   // optional
    }
    ```

    The `messages` format mirrors the one used in the Streamlit app
    (`src/streamlit_app.py`). The endpoint returns a Server-Sent Events (SSE)
    stream where each event corresponds to a LangGraph `astream_events`
    emission.

    Clients can consume the stream using the standard EventSource API
    in the browser or libraries such as `httpx-sse` in Python.
    """

    messages: List[Dict[str, Any]] = payload.get("messages", [])
    # Identifiers forwarded from the Streamlit frontend. These can be used
    # by the LangGraph agent and logging layer for per-session and
    # per-user state, analytics, etc.
    session_id: str | None = payload.get("session_id")
    user_id: str | None = payload.get("user_id")

    async def event_generator() -> AsyncGenerator[bytes, None]:
        """Yield simplified LangGraph events as SSE-formatted bytes.

        Internally this uses ``graph_runnable.astream_events`` (version "v2")
        and maps the rich LangGraph events onto a small, JSON-serialisable
        protocol that is easy to consume from frontends:

        - ``{"type": "token", "content": str}``
        - ``{"type": "tool_start", "name": str, "input": Any}``
        - ``{"type": "tool_end", "name": str, "output": str}``
        - ``{"type": "chain_end", "follow_up_tip": str | null}``
        - ``{"type": "error", "message": str}``

        The raw ``astream_events`` API is thus used in the backend, while the
        client deals with a stable, minimal JSON schema.
        """

        # Names of internal tools whose LLM output should not be treated as
        # user-visible assistant content (nor stored in the DB). For these
        # tools we still stream tool_start/tool_end events, but suppress
        # intermediate chat model tokens.
        hidden_tool_names = {"sql_db_query_checker"}
        suppress_tokens = False

        try:
            # Persist only the latest user message for this request to the local DB.
            latest_user_msg: Dict[str, Any] | None = None
            for msg in reversed(messages):
                if msg.get("role") == "user" and msg.get("content"):
                    latest_user_msg = msg
                    break

            if latest_user_msg is not None:
                log_message(
                    session_id=session_id,
                    role="user",
                    content=latest_user_msg["content"],
                    user_id=user_id,
                )

            # Forward messages and optional session_id into the graph as state.
            state: Dict[str, Any] = {"messages": messages}
            if session_id is not None:
                state["session_id"] = session_id
            if user_id is not None:
                state["user_id"] = user_id

            # Accumulate the assistant's streamed response so we can log the
            # full message once the chain completes.
            assistant_text = ""

            async for event in graph_runnable.astream_events(
                state, version="v2"
            ):
                event_type = event["event"]
                data = event.get("data", {})

                payload: Dict[str, Any]

                if event_type == "on_chat_model_stream":
                    # Stream incremental model tokens.
                    chunk = data.get("chunk")
                    # ``chunk`` is typically a LangChain message chunk
                    # object with a ``content`` attribute.
                    content = getattr(chunk, "content", None)
                    if not content:
                        continue
                    # When ``suppress_tokens`` is True (e.g., for internal
                    # query-checker tools), we do not surface or persist
                    # these tokens as part of the assistant's final reply.
                    if suppress_tokens:
                        continue
                    # Accumulate assistant tokens so they can be logged
                    # as a single message when the chain ends.
                    assistant_text += content
                    payload = {"type": "token", "content": content}

                elif event_type == "on_tool_start":
                    tool_name = event.get("name")
                    if tool_name in hidden_tool_names:
                        suppress_tokens = True

                    payload = {
                        "type": "tool_start",
                        "name": tool_name,
                        "input": data.get("input"),
                    }

                elif event_type == "on_tool_end":
                    output = data.get("output")
                    output_content = getattr(output, "content", None)
                    if output_content is None:
                        # Fallback to string representation.
                        output_content = str(output)

                    tool_name = event.get("name")
                    if tool_name in hidden_tool_names:
                        # Re-enable token streaming for normal model output
                        # after the internal tool finishes.
                        suppress_tokens = False

                    payload = {
                        "type": "tool_end",
                        "name": tool_name,
                        "output": output_content,
                    }

                elif event_type == "on_chain_end":
                    state = data.get("output", {})
                    follow_up_tip = None
                    if isinstance(state, dict):
                        follow_up_tip = state.get("follow_up_tip")

                    # Log the final assistant message content once the
                    # chain has finished streaming.
                    if assistant_text:
                        log_message(
                            session_id=session_id,
                            role="assistant",
                            content=assistant_text,
                            user_id=user_id,
                        )

                    payload = {
                        "type": "chain_end",
                        "follow_up_tip": follow_up_tip,
                    }

                else:
                    # Ignore less relevant internal events by default.
                    continue

                chunk = json.dumps(payload)
                yield f"data: {chunk}\n\n".encode("utf-8")

        except Exception as exc:  # pragma: no cover - defensive fallback
            error_payload = {
                "type": "error",
                "message": str(exc),
            }
            yield f"data: {json.dumps(error_payload)}\n\n".encode("utf-8")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )


@app.get("/chat/history/{session_id}")
async def chat_history(session_id: str) -> Dict[str, Any]:
    """Return the stored chat history for a given session_id.

    The response mirrors the message format used by the Streamlit app
    (role/content pairs), with an additional created_at field per message.
    """

    records = get_messages(session_id)
    return {
        "session_id": session_id,
        "messages": [
            {
                "role": rec["role"],
                "content": rec["content"],
                "created_at": rec["created_at"],
            }
            for rec in records
        ],
    }


__all__ = ["app"]


@app.get("/chat/recent-sessions/{user_id}")
async def recent_sessions(user_id: str, limit: int = 10) -> Dict[str, Any]:
    """Return the most recent chat sessions for a given user.

    The result includes up to ``limit`` sessions (default: 10), ordered by
    last activity descending. Each entry contains the session_id, a preview
    of the first user message, and the last_activity timestamp.
    """

    sessions = get_recent_sessions_for_user(user_id=user_id, limit=limit)
    return {"user_id": user_id, "sessions": sessions}
