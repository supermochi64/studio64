// Claude's tools for the hack's launch screen (docs/title-screen.md): read it, change it (the
// browser renders the logo maker's picture and the cover: web/js/title/index.js 'title_set'),
// and play it in the game.
import { normalizeTitle, PRESETS, FONTS, LOGO_ANIMS, EMBLEMS } from '../../web/js/title/schema.js';
import { GAME_SONGS } from '../../web/js/music.js';

export default function titleTools({ tool, z, card, rpc, text, opts, project: p }) {
  const color = z.string().describe('#rrggbb');
  return [
    tool('get_title_screen', 'The hack\'s launch screen: is it on, splash screens, logo (logo maker settings or picture), background, Press Start text, music, file select.', {},
      card('get_title_screen', () => 'Reading the title screen', async () => ({ result: text(normalizeTitle(p.title)) })), opts),

    tool('set_title_screen', `Change the hack's launch screen (what players see first: splash screens, then the title with its logo and "Press Start", then the file select). Only the fields given change. Turn it on with on: true.
Logo maker fonts: ${FONTS.map((f) => f[0]).join(', ')}. Logo styles (presets): ${PRESETS.map((x) => x.id).join(', ')}. Animations: ${LOGO_ANIMS.map((a) => a[0]).join(', ')}. Emblems: ${EMBLEMS.map((e) => e[0]).join(', ')}.
Backgrounds: game (the game's own title screen with Mario's face; head: false hides the face), level (a camera flies around a level: '9:1' for an original level number, 'c:<id>' for a custom level), gradient, color, image (needs an uploaded picture). Music: { kind: 'game', seq } (game songs: ${GAME_SONGS.map((g) => `${g.name} ${g.seq}`).join(', ')}) or { kind: 'song', song: <sound studio song id> } or { kind: 'none' }.`, {
      on: z.boolean().optional(),
      preset: z.string().optional().describe('a logo style to start from'),
      logo: z.object({
        kind: z.enum(['maker', 'image', 'game', 'none']).optional(),
        anim: z.string().optional(), x: z.number().optional().describe('0..1 across'), y: z.number().optional().describe('0..1 down'), scale: z.number().optional().describe('logo width, part of the screen width 0.1..1.2'),
        maker: z.object({
          text: z.string().optional(), sub: z.string().optional().describe('second line, like "64"'), font: z.string().optional(),
          fill: z.enum(['letters', 'gradient', 'solid']).optional(), colors: z.array(color).optional(), c1: color.optional(), c2: color.optional(),
          outline: color.optional(), outlineW: z.number().optional(), extrude: z.number().optional().describe('3D depth 0..40'), extrudeColor: color.optional(),
          arc: z.number().optional().describe('-40..40 degrees'), tilt: z.number().optional(), shine: z.boolean().optional(),
          emblem: z.string().optional(), emblemColor: color.optional(), emblemPos: z.enum(['left', 'top', 'right', 'behind']).optional(),
        }).optional(),
      }).optional(),
      bg: z.object({
        kind: z.enum(['game', 'level', 'gradient', 'color', 'image']).optional(), head: z.boolean().optional(), color: color.optional(), color2: color.optional(),
        angle: z.number().optional(), level: z.string().optional(), dim: z.number().optional(),
      }).optional(),
      press: z.object({ text: z.string().optional(), color: color.optional(), outline: color.optional(), blink: z.boolean().optional(), font: z.enum(['game', 'sans', 'serif']).optional(), y: z.number().optional(), size: z.number().optional() }).optional(),
      music: z.object({ kind: z.enum(['game', 'song', 'none']), seq: z.number().optional(), song: z.string().optional() }).optional(),
      files: z.object({ on: z.boolean().optional(), heading: z.string().optional(), sub: z.string().optional(), color: color.optional(), bg: color.optional(), bg2: color.optional(), card: color.optional(), showName: z.boolean().optional() }).optional(),
      splashes: z.array(z.object({ kind: z.enum(['studio', 'text']), text: z.string().optional(), sub: z.string().optional(), bg: color.optional(), color: color.optional(), seconds: z.number().optional() })).optional().describe('replaces all splash screens'),
    }, card('set_title_screen', () => 'Changing the title screen', async (a) => {
      const title = { ...a };
      delete title.preset;
      if (a.preset) {
        const pr = PRESETS.find((x) => x.id === a.preset || x.name.toLowerCase() === String(a.preset).toLowerCase());
        if (pr) title.logo = { ...(title.logo || {}), kind: title.logo?.kind || 'maker', maker: { ...pr.maker, ...(title.logo?.maker || {}) } };
      }
      const r = await rpc('title_set', { title, summary: 'Changed the title screen' });
      const t = r.title;
      return { summary: t.on ? 'Title screen updated' : 'Title screen updated (it is off)', result: text({ on: t.on, logo: t.logo.kind, background: t.bg.kind, splashes: t.splashes.length, fileSelect: t.files.on }) };
    }), opts),

    tool('preview_title_screen', 'Play the launch screen in the user\'s game (they press Start to go on), then go back to where Mario was.', {},
      card('preview_title_screen', () => 'Playing the title screen', async () => {
        const r = await rpc('title_preview', {});
        return { summary: 'Playing the title screen in the game', result: text(r) };
      }), opts),
  ];
}
