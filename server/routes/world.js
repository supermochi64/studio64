// Sub-areas of custom levels and the hack's world flow (start, hub, goal): websocket
// messages area_create / area_rename / area_delete / world_set. See docs/world.md.
import { handleWorldMessage } from '../world_store.js';

export default (ctx) => ({
  ws: async (msg, client, project) => handleWorldMessage(msg, { project, hub: ctx.hub, client }),
});
