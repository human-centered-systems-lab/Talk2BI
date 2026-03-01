from typing import Annotated, TypedDict, Literal

from langgraph.prebuilt import ToolNode
from langchain_core.tools import tool, StructuredTool
from langgraph.graph import START, StateGraph
from langgraph.graph.message import AnyMessage, add_messages
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper
from langchain_openai import ChatOpenAI


# DuckDuckGo search tool
search_DDG = StructuredTool.from_function(
    name="Search",
    func=DuckDuckGoSearchAPIWrapper().run,
    description="""
    Useful for answering questions about current events.
    Prefer targeted search queries.
    """,
)

@tool
def get_weather(location: str):
    """Return current weather for a given location (mock implementation)."""
    return "It's 90 degrees and sunny."


# Tools exposed to the graph
tool_node = ToolNode([get_weather, search_DDG])


# Graph state definition (extendable with additional keys if needed)
class GraphsState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


graph = StateGraph(GraphsState)


def should_continue(state: GraphsState) -> Literal["tools", "__end__"]:
    """Route to tool execution if the model requested a tool call."""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "__end__"


def _call_model(state: GraphsState):
    """Invoke the LLM with tool binding."""
    llm = ChatOpenAI(
        temperature=0.7,
        streaming=True,
    ).bind_tools(tools, parallel_tool_calls=False)

    response = llm.invoke(state["messages"])
    return {"messages": [response]}


# Graph structure
graph.add_edge(START, "modelNode")
graph.add_node("tools", tool_node)
graph.add_node("modelNode", _call_model)

graph.add_conditional_edges(
    "modelNode",
    should_continue,
)

graph.add_edge("tools", "modelNode")

# Compile runnable graph
graph_runnable = graph.compile()