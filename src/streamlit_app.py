import streamlit as st
import asyncio
from dotenv import load_dotenv
import uuid

from agent.agent import graph_runnable
from utils.astream import stream_graph_events

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
        "Enabling Natural Language Access to Business Intelligence. An open-access initiative by the [human-centered systems Lab (h-lab)](https://h-lab.win.kit.edu/), Karlsruhe Institute of Technology (KIT), Germany."
        ""

        if st.button(":material/chat: New Chat", use_container_width=True):
            st.session_state.messages = []
            st.session_state.messages.append(
                {"role": "assistant", "content": WELCOME_MESSAGE}
            )
            st.session_state.thread_id = str(uuid.uuid4())
            st.rerun()

        "[View the source code](https://github.com/human-centered-systems-lab/Talk2BI)"

        st.caption(
            "Built using LangGraph and Streamlit."
        )

    # Initialize session state
    if "messages" not in st.session_state:
        st.session_state.messages = []
        st.session_state.messages.append(
            {"role": "assistant", "content": WELCOME_MESSAGE}
        )
        st.session_state.thread_id = str(uuid.uuid4())

    # Render chat history
    for idx, message in enumerate(st.session_state.messages):
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

            # If there is a follow-up tip associated with this assistant
            # message, render it in a subtle info box just below.
            tips = st.session_state.get("follow_up_tips", {})
            tip_text = tips.get(idx)
            if message["role"] == "assistant" and tip_text:
                st.info(tip_text)

    # Handle user input
    user_input = st.chat_input("Ask me anything...")
    if user_input:
        st.chat_message("user").markdown(user_input)
        st.session_state.messages.append(
            {"role": "user", "content": user_input}
        )

        # Render assistant response using shared streaming utility
        with st.chat_message("assistant"):
            container = st.container()

            final_text, follow_up_tip_text = await stream_graph_events(
                graph_runnable=graph_runnable,
                messages=st.session_state.messages,
                container=container,
            )

            # Persist assistant response
            st.session_state.messages.append(
                {"role": "assistant", "content": final_text}
            )

            # Store tip keyed by message index so it can be displayed with the
            # corresponding assistant message when rendering history.
            if follow_up_tip_text:
                st.info(follow_up_tip_text)
                tips = st.session_state.get("follow_up_tips", {})
                assistant_index = len(st.session_state.messages) - 1
                tips[assistant_index] = follow_up_tip_text
                st.session_state["follow_up_tips"] = tips

if __name__ == "__main__":
    asyncio.run(main())