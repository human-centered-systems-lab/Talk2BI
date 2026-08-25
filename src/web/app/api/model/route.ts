import { NextResponse } from "next/server";
import {
  AVAILABLE_MODEL_OPTIONS,
  CURRENT_MODEL,
} from "@/lib/ai/models";

export async function GET() {
  return NextResponse.json({
    model: CURRENT_MODEL,
    models: AVAILABLE_MODEL_OPTIONS,
  });
}
