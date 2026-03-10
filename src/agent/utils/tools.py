"""
This module centralizes all LangChain tools used by the agent so they can be
easily reused and extended.
"""

import os
from langchain_core.tools import tool, StructuredTool
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper, SQLDatabase
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Load environment variables
load_dotenv()

# Import to register Databricks dialect with SQLAlchemy
from databricks.sqlalchemy import DatabricksDialect

# Create Databricks database connection once
host = os.getenv("DATABRICKS_HOST")
token = os.getenv("DATABRICKS_TOKEN")
warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID")
catalog = os.getenv("DATABRICKS_CATALOG")
schema = os.getenv("DATABRICKS_SCHEMA")

db = SQLDatabase.from_databricks(
    host=host,
    api_token=token,
    catalog=catalog,
    schema=schema,
    warehouse_id=warehouse_id,
    sample_rows_in_table_info=3,
    engine_args={"pool_pre_ping": True}
)


# DuckDuckGo search tool
#search_DDG = StructuredTool.from_function(
#    name="Search",
#    func=DuckDuckGoSearchAPIWrapper().run,
#    description="""
#    Useful for answering questions about current events.
#    Prefer targeted search queries.
#    """,
#)

@tool
def get_weather(location: str):
    """Return current weather for a given location (mock implementation)."""
    return "It's 90 degrees and sunny."


def get_sql_tools(llm):
    """Create and return SQL database tools for Databricks."""
    toolkit = SQLDatabaseToolkit(db=db, llm=llm)
    return toolkit.get_tools()

llm = ChatOpenAI(
        model=os.getenv("MODEL"),
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("BASE_URL"),
        temperature=0.7,
        streaming=True,
    )


tools = [get_weather] + get_sql_tools(llm)