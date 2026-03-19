import { withMockAuth } from "./mockAuth.js";
import { rawHandler as raw } from "../expenses/index.js";

export { withMockAuth } from "./mockAuth.js";
export const handler = withMockAuth(raw);