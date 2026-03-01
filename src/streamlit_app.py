import streamlit as st
import asyncio
from dotenv import load_dotenv
import uuid
from agent.agent import graph_runnable

APP_TITLE = "Talk2BI"
APP_ICON = "💡"
WELCOME_MESSAGE = "Hello! How can I assist you today?"

async def main():
    load_dotenv()

    st.set_page_config(
        page_title=APP_TITLE,
        page_icon=APP_ICON,
        menu_items={},
    )

    st.session_state.user_id = str(uuid.uuid4())

    with st.sidebar:
        st.header(f"{APP_ICON} {APP_TITLE}")

        ""
        "Enabling Natural Language Access to Business Intelligence. Built using LangGraph and Streamlit. An open-access initiative by the Human-Centered Systems Lab (h-Lab), Karlsruhe Institute of Technology (KIT), Germany."
        ""

        if st.button(":material/chat: New Chat", use_container_width=True):
            st.session_state.messages = []
            st.session_state.messages.append(
                {"role": "assistant", "content": WELCOME_MESSAGE}
            )
            st.session_state.thread_id = str(uuid.uuid4())
            st.rerun()

        "[View the source code](https://github.com/human-centered-systems-lab/Talk2BI)"

    # Initialize session state
    if "messages" not in st.session_state:
        st.session_state.messages = []
        st.session_state.messages.append(
            {"role": "assistant", "content": WELCOME_MESSAGE}
        )
        st.session_state.thread_id = str(uuid.uuid4())

    # Render chat history
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    # Handle user input
    user_input = st.chat_input("Ask me anything...")
    if user_input:
        st.chat_message("user").markdown(user_input)
        st.session_state.messages.append(
            {"role": "user", "content": user_input}
        )

        with st.chat_message("assistant"):
            placeholder = st.container()
            thoughts_placeholder = placeholder.container()
            token_placeholder = placeholder.empty()
            final_text = ""

        try:
            async for event in graph_runnable.astream_events(
                {"messages": st.session_state.messages}, version="v2"
            ):
                event_type = event["event"]

                if event_type == "on_chat_model_stream":
                    # Stream model output tokens
                    addition = event["data"]["chunk"].content
                    final_text += addition
                    if addition:
                        token_placeholder.write(final_text)

                elif event_type == "on_tool_start":
                    # Tool invocation started
                    with thoughts_placeholder:
                        status_placeholder = st.empty()
                        with status_placeholder.status(
                            "Calling Tool...", expanded=True
                        ) as s:
                            st.write("Called ", event["name"])
                            st.write("Tool input:")
                            st.code(event["data"].get("input"))
                            st.write("Tool output:")
                            output_placeholder = st.empty()
                            s.update(
                                label="Completed Calling Tool!",
                                expanded=False,
                            )

                elif event_type == "on_tool_end":
                    # Tool invocation finished
                    with thoughts_placeholder:
                        if "output_placeholder" in locals():
                            output_placeholder.code(
                                event["data"].get("output").content
                            )

        except Exception as e:
            final_text += (
                f"Thank you for your message. "
                f"However, an error occurred while processing the response: {e}"
            )
            token_placeholder.write(final_text)

        # Persist assistant response
        st.session_state.messages.append(
            {"role": "assistant", "content": final_text}
        )


if __name__ == "__main__":
    asyncio.run(main())