import { withLocalAuth } from "./mockAuth.js";
import { rawHandler as raw } from "../expenses/index.js";

export { withLocalAuth as withMockAuth } from "./mockAuth.js";
export const handler = withLocalAuth(raw);