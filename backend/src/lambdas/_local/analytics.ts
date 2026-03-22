import { withLocalAuth } from "./mockAuth.js";
import { handler as raw } from "../analytics/index.js";

export { withLocalAuth as withMockAuth } from "./mockAuth.js";
export const handler = withLocalAuth(raw);
