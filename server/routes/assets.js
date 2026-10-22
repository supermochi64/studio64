// Imported models, texture replacements, custom materials and skies: the asset
// store's HTTP API (see ../assets.js and docs/assets.md).
import { handleAssets } from '../assets.js';

export default (ctx) => ({
  http: (req, res, url) => handleAssets(req, res, url, { projects: ctx.projects, hub: ctx.hub }),
});
