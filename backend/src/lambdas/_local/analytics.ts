import { withMockAuth } from "./mockAuth.js";
import { handler as raw } from "../analytics/index.js";

export { withMockAuth } from "./mockAuth.js";
export const handler = withMockAuth(raw);
