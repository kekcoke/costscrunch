import { withMockAuth } from "./mockAuth.js";
import { handler as raw } from "../groups/index.js";

export { withMockAuth } from "./mockAuth.js";
export const handler = withMockAuth(raw);