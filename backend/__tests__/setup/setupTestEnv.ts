import dotenv from "dotenv"
import { expand } from "dotenv-expand"

export function setup() {
  expand(dotenv.config({ path: ".env.test" }))
}