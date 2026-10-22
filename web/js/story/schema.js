// What events, conditions, actions and cutscene steps can be, and how each is shown and edited.
// Shared by the Story panel, the build-mode Logic tool and (as text) Claude's tool descriptions.

// field kinds: zone, npc, star, object, number, seconds, level, var, op, value, dialog, text, cutscene,
// entry, cap, sound, music, event, pos, bool, answer, ease, choice:<a|b|c>
export const TRIGGERS = {
  enter_zone: { label: 'Mario enters a zone', icon: 'zone', fields: [['zone', 'zone', 'Zone']] },
  leave_zone: { label: 'Mario leaves a zone', icon: 'zone', fields: [['zone', 'zone', 'Zone']] },
  talk: { label: 'Mario talks to a character', icon: 'talk', fields: [['uid', 'npc', 'Character'], ['answer', 'answer', 'Answer']] },
  star: { label: 'Mario collects a star', icon: 'star', fields: [['uid', 'star', 'Star']] },
  coins: { label: 'Mario has enough coins', icon: 'coin', fields: [['count', 'number', 'Coins']] },
  red_coins: { label: 'Red coins collected', icon: 'coin', fields: [['count', 'number', 'Red coins']] },
  defeat: { label: 'An object is defeated or gone', icon: 'skull', fields: [['uid', 'object', 'Object']] },
  switch: { label: 'A switch is pressed', icon: 'switch', fields: [['uid', 'object', 'Switch']] },
  object_event: { label: 'A custom object reacts', icon: 'bolt', fields: [['uid', 'object', 'Object'], ['event', 'choice:defeated|spotted|hit|hurt_mario', 'When it']] },
  timer: { label: 'Time passes in the level', icon: 'clock', fields: [['seconds', 'seconds', 'After seconds']] },
  level_enter: { label: 'Mario enters a level or area', icon: 'door', fields: [['level', 'level', 'Level or area']] },
  var: { label: 'A variable reaches a value', icon: 'var', fields: [['var', 'var', 'Variable'], ['op', 'op', ''], ['value', 'value', 'Value']] },
  game_start: { label: 'A new game starts', icon: 'play', fields: [] },
  vehicle: { label: 'Mario gets in or out of a car', icon: 'bolt', fields: [['uid', 'object', 'Car (empty: any)'], ['event', 'choice:enter|exit|crash', 'When he']] }, // (../vehicles.js)
  race: { label: 'A race starts or ends', icon: 'flag', fields: [['uid', 'object', 'Race (empty: any)'], ['result', 'choice:won|lost|start', 'When Mario']] },
  katana_duel: { label: 'A katana duel starts or ends', icon: 'flag', fields: [['uid', 'object', 'Duel (empty: any)'], ['result', 'choice:won|lost|start', 'When Mario']] }, // (../katana.js)
};

export const CONDITIONS = {
  flag: { label: 'Flag is set', fields: [['var', 'flagvar', 'Flag'], ['value', 'bool', 'Is']] },
  var: { label: 'Counter compares', fields: [['var', 'var', 'Variable'], ['op', 'op', ''], ['value', 'number', 'Value']] },
  stars: { label: 'Total stars', fields: [['op', 'op', ''], ['value', 'number', 'Stars']] },
  coins: { label: 'Coins in this level', fields: [['op', 'op', ''], ['value', 'number', 'Coins']] },
  lives: { label: 'Lives', fields: [['op', 'op', ''], ['value', 'number', 'Lives']] },
  health: { label: 'Health (0-8)', fields: [['op', 'op', ''], ['value', 'number', 'Health']] },
  cap: { label: 'Mario wears a cap', fields: [['cap', 'cap', 'Cap'], ['value', 'bool', 'Wears it']] },
  act: { label: 'Act (star chosen)', fields: [['op', 'op', ''], ['value', 'number', 'Act']] },
  level: { label: 'Mario is in a level', fields: [['key', 'level', 'Level']] },
  event_done: { label: 'Another event happened', fields: [['event', 'event', 'Event'], ['value', 'bool', 'Happened']] },
  star: { label: 'A star is collected', fields: [['uid', 'star', 'Star'], ['value', 'bool', 'Collected']] },
  random: { label: 'Random chance', fields: [['chance', 'number', 'Percent']] },
  shotgun: { label: 'Mario has the shotgun', fields: [['value', 'bool', 'Has it']] },
  driving: { label: 'Mario is driving a car', fields: [['value', 'bool', 'Driving']] },
  katana: { label: 'Mario has the katana', fields: [['value', 'bool', 'Has it']] },
  katana_duel_won: { label: 'A katana duel is won', fields: [['uid', 'object', 'Duel (empty: any)'], ['value', 'bool', 'Won']] },
};

export const ACTIONS = {
  dialog: { label: 'Show a dialog', group: 'Talk', fields: [['dialog', 'dialog', 'Dialog'], ['answer_var', 'flagvar', 'Store "Yes" in flag (questions)']] },
  caption: { label: 'Show a caption', group: 'Talk', fields: [['text', 'text', 'Text'], ['seconds', 'seconds', 'Seconds']] },
  set_flag: { label: 'Set a flag', group: 'Variables', fields: [['var', 'flagvar', 'Flag'], ['value', 'choice:true|false|toggle', 'To']] },
  set_var: { label: 'Change a counter', group: 'Variables', fields: [['var', 'var', 'Counter'], ['op', 'choice:set|add|sub', ''], ['value', 'number', 'Value']] },
  show: { label: 'Show an object', group: 'Objects', fields: [['uid', 'object', 'Object']] },
  hide: { label: 'Remove an object', group: 'Objects', fields: [['uid', 'object', 'Object']] },
  open_door: { label: 'Open a door / gate', group: 'Objects', fields: [['uid', 'object', 'Door, pipe, gate or wall']] },
  lock_door: { label: 'Lock a door', group: 'Objects', fields: [['uid', 'warpobj', 'Door, pipe, painting or warp zone']] },
  spawn: { label: 'Spawn objects', group: 'Objects', fields: [['entry', 'entry', 'Object'], ['count', 'number', 'How many'], ['at', 'where', 'Where']] },
  start_motion: { label: 'Start an object\'s motion', group: 'Objects', fields: [['uid', 'object', 'Object (motion triggered by event)']] },
  give_star: { label: 'Give a star', group: 'Rewards', fields: [['uid', 'star', 'Star'], ['at', 'choice:mario|spot', 'Appears']] },
  coins: { label: 'Give coins', group: 'Rewards', fields: [['amount', 'number', 'Coins']] },
  lives: { label: 'Give lives', group: 'Rewards', fields: [['amount', 'number', 'Lives']] },
  health: { label: 'Heal Mario', group: 'Rewards', fields: [['amount', 'number', 'Wedges (8 = full)']] },
  cap: { label: 'Give a cap', group: 'Rewards', fields: [['cap', 'cap', 'Cap'], ['seconds', 'seconds', 'Seconds (0 = normal)']] },
  music: { label: 'Play music', group: 'Sound', fields: [['seq', 'music', 'Music']] },
  sound: { label: 'Play a sound', group: 'Sound', fields: [['bits', 'sound', 'Sound']] },
  cutscene: { label: 'Play a cutscene', group: 'Camera', fields: [['cutscene', 'cutscene', 'Cutscene']] },
  shake: { label: 'Shake the screen', group: 'Camera', fields: [['strength', 'choice:small|big', 'Strength']] },
  warp: { label: 'Warp Mario to a level or area', group: 'Mario', fields: [['level', 'level', 'Level or area'], ['uid', 'arrival', 'Comes out of'], ['pos', 'pos', 'Position (optional)']] },
  teleport: { label: 'Move Mario', group: 'Mario', fields: [['pos', 'pos', 'Position']] },
  shotgun: { label: 'Give or take the shotgun', group: 'Mario', fields: [['on', 'choice:give|take', '']] },
  katana: { label: 'Give or take the katana', group: 'Mario', fields: [['on', 'choice:give|take', '']] },
  start_race: { label: 'Start a race', group: 'Mario', fields: [['uid', 'object', 'Race (its rival car)']] },
  timer: { label: 'Timer', group: 'Game', fields: [['op', 'choice:start|stop|resume|hide', '']] },
  wait: { label: 'Wait', group: 'Game', fields: [['seconds', 'seconds', 'Seconds']] },
  if: { label: 'If … then … else', group: 'Game', fields: [] },
  enable_event: { label: 'Turn an event on/off', group: 'Game', fields: [['event', 'event', 'Event'], ['on', 'bool', 'On'], ['reset', 'bool', 'Can happen again']] },
  finish_level: { label: 'Finish the level', group: 'Game', fields: [] },
  ending: { label: 'Play the ending & credits', group: 'Game', fields: [] },
};

export const STEPS = {
  shot: { label: 'Camera shot', fields: [['seconds', 'seconds', 'Move time'], ['ease', 'ease', 'Easing']] },
  follow_mario: { label: 'Back to the game camera', fields: [] },
  dialog: { label: 'Dialog', fields: [['dialog', 'dialog', 'Dialog']] },
  caption: { label: 'Caption', fields: [['text', 'text', 'Text'], ['seconds', 'seconds', 'Seconds']] },
  wait: { label: 'Wait', fields: [['seconds', 'seconds', 'Seconds']] },
  fade: { label: 'Fade', fields: [['to', 'choice:out|in', ''], ['seconds', 'seconds', 'Seconds'], ['color', 'color', 'Color']] },
  move: { label: 'Move an object', fields: [['uid', 'object', 'Object'], ['pos', 'pos', 'To'], ['seconds', 'seconds', 'Seconds'], ['wait', 'bool', 'Wait for it']] },
  mario: { label: 'Place Mario', fields: [['pos', 'pos', 'Position']] },
  action: { label: 'Do an action', fields: [] },
};

export const OPS = ['>=', '>', '==', '!=', '<', '<='];
export const EASES = ['smooth', 'linear', 'in', 'out', 'cut'];
export const CAPS = ['wing', 'metal', 'vanish'];
export const MUSIC = [[3, 'Bob-omb Battlefield'], [4, 'Inside the castle'], [5, 'Dire Dire Docks'], [6, 'Lethal Lava Land'], [7, 'Bowser road'],
  [8, 'Snow mountain'], [9, 'Slider'], [10, 'Haunted house'], [11, 'Piranha lullaby'], [12, 'Hazy Maze Cave'], [13, 'Star select'],
  [14, 'Wing cap'], [15, 'Metal cap'], [16, 'Bowser message'], [17, 'Bowser fight'], [18, 'Star catch'], [19, 'Merry-go-round'],
  [20, 'Race'], [21, 'Star appears'], [22, 'Boss'], [23, 'Key get'], [24, 'Endless stairs'], [25, 'Final Bowser'], [26, 'Staff roll'],
  [27, 'Solved'], [28, 'Toad message'], [29, 'Peach message'], [30, 'Intro'], [31, 'Victory'], [32, 'Ending'], [33, 'File select'], [34, 'Lakitu']];

// The characters the Logic tool and Claude can place. kind 'native': the object's own behavior talks;
// 'npc': bhvStudioNpc with the model of `model` and an animation set.
export const CHARACTERS = [
  { id: 'toad', label: 'Toad', model: 'toad_message', anim: [1, 6] },
  { id: 'bobomb_buddy', label: 'Bob-omb Buddy', entry: 'bobomb_buddy' },
  { id: 'sign', label: 'Sign post', entry: 'message_panel', sign: true },
  { id: 'wall_sign', label: 'Wall sign', entry: 'sign_on_wall', sign: true },
  { id: 'pianta', label: 'Pianta', entry: 'sms:pianta' },
  { id: 'pianta_woman', label: 'Pianta (woman)', entry: 'sms:pianta_woman' },
  { id: 'koopa', label: 'Koopa', model: 'koopa', anim: [3, 7] },
  { id: 'goomba', label: 'Goomba', model: 'goomba', anim: [4, 0] },
  { id: 'penguin', label: 'Penguin', model: 'tuxies_mother', anim: [5, 3] },
  { id: 'yoshi', label: 'Yoshi', model: 'yoshi', anim: [7, 0] },
  { id: 'peach', label: 'Peach', model: 'prop:peach', anim: [8, 0] },
  { id: 'ukiki', label: 'Ukiki', model: 'ukiki', anim: [6, 0] },
  { id: 'chuckya', label: 'Chuckya', model: 'chuckya', anim: [9, 5] },
  { id: 'bobomb', label: 'Bob-omb', model: 'bobomb', anim: [2, 0] },
  { id: 'boo', label: 'Boo', model: 'boo', anim: [0, 0] },
];

// One line of text describing a trigger / condition / action, for lists and for Claude.
export function describe(kind, x, names = {}) {
  const n = (k, v) => names[k]?.(v) ?? (v == null || v === '' ? '?' : String(v));
  if (!x) return '';
  if (kind === 'trigger') {
    switch (x.type) {
      case 'enter_zone': return `Mario enters ${n('zone', x.zone)}`;
      case 'leave_zone': return `Mario leaves ${n('zone', x.zone)}`;
      case 'talk': return `Mario talks to ${n('npc', x.uid)}${x.answer && x.answer !== 'any' ? ` and answers ${x.answer === 'yes' ? 'the first choice' : 'the second choice'}` : ''}`;
      case 'star': return x.uid && x.uid !== 'any' ? `Mario collects ${n('star', x.uid)}` : 'Mario collects any star';
      case 'coins': return `Mario has ${x.count || 0} coins`;
      case 'red_coins': return `${x.count || 0} red coins collected`;
      case 'defeat': return `${n('object', x.uid)} is defeated`;
      case 'switch': return `${n('object', x.uid)} is pressed`;
      case 'object_event': return `${n('object', x.uid)} ${({ defeated: 'is defeated', spotted: 'spots Mario', hit: 'is hit', hurt_mario: 'hurts Mario' })[x.event || 'defeated']}`;
      case 'timer': return `${x.seconds || 0} s after entering the level`;
      case 'level_enter': return x.level && x.level !== 'any' ? `Mario enters ${n('level', x.level)}` : 'Mario enters any level';
      case 'var': return `${n('var', x.var)} ${x.op || '>='} ${x.value ?? true}`;
      case 'game_start': return 'A new game starts';
      case 'vehicle': return `Mario ${({ enter: 'gets into', exit: 'gets out of', crash: 'crashes' })[x.event || 'enter']} ${x.uid ? n('object', x.uid) : 'a car'}`;
      case 'race': return x.result === 'start' ? `${x.uid ? n('object', x.uid) : 'A race'} starts` : `Mario ${x.result === 'lost' ? 'loses' : 'wins'} ${x.uid ? n('object', x.uid) : 'a race'}`;
      case 'katana_duel': return x.result === 'start' ? `${x.uid ? n('object', x.uid) : 'A katana duel'} starts` : `Mario ${x.result === 'lost' ? 'loses' : 'wins'} ${x.uid ? n('object', x.uid) : 'a katana duel'}`;
      default: return x.type;
    }
  }
  if (kind === 'condition') {
    switch (x.type) {
      case 'flag': return `${n('var', x.var)} is ${x.value === false ? 'not set' : 'set'}`;
      case 'var': return `${n('var', x.var)} ${x.op || '>='} ${x.value ?? 0}`;
      case 'stars': case 'coins': case 'lives': case 'health': return `${CONDITIONS[x.type].label} ${x.op || '>='} ${x.value ?? 0}`;
      case 'cap': return `Mario ${x.value === false ? 'has no' : 'wears the'} ${x.cap || 'wing'} cap`;
      case 'act': return `Act ${x.op || '=='} ${x.value ?? 1}`;
      case 'level': return `In ${n('level', x.key)}`;
      case 'event_done': return `“${n('event', x.event)}” ${x.value === false ? 'has not happened' : 'happened'}`;
      case 'star': return `${n('star', x.uid)} ${x.value === false ? 'not collected' : 'collected'}`;
      case 'random': return `${x.chance ?? 50}% chance`;
      case 'shotgun': return `Mario ${x.value === false ? 'has no' : 'has the'} shotgun`;
      case 'driving': return `Mario ${x.value === false ? 'is not driving' : 'is driving'}`;
      case 'katana': return `Mario ${x.value === false ? 'has no' : 'has the'} katana`;
      case 'katana_duel_won': return `${x.uid ? n('object', x.uid) : 'A katana duel'} ${x.value === false ? 'is not won' : 'is won'}`;
      default: return x.type;
    }
  }
  const a = x;
  switch (a.type) {
    case 'dialog': return `Say ${n('dialog', a.dialog)}`;
    case 'caption': return `Caption “${a.text || ''}”`;
    case 'set_flag': return `${a.value === 'toggle' ? 'Toggle' : a.value === false || a.value === 'false' ? 'Clear' : 'Set'} ${n('var', a.var)}`;
    case 'set_var': return `${n('var', a.var)} ${a.op === 'add' ? '+' : a.op === 'sub' ? '−' : '='} ${a.value ?? 0}`;
    case 'show': return `Show ${n('object', a.uid)}`;
    case 'hide': return `Remove ${n('object', a.uid)}`;
    case 'open_door': return `Open ${n('object', a.uid)}`;
    case 'lock_door': return `Lock ${n('object', a.uid)}`;
    case 'spawn': return `Spawn ${a.count || 1} × ${n('entry', a.entry)}`;
    case 'give_star': return `Give ${n('star', a.uid)}`;
    case 'start_motion': return `Start ${n('object', a.uid)} moving`;
    case 'coins': return `Give ${a.amount || 1} coins`;
    case 'lives': return `Give ${a.amount || 1} lives`;
    case 'health': return 'Heal Mario';
    case 'cap': return `Give the ${a.cap || 'wing'} cap`;
    case 'music': return `Play ${n('music', a.seq ?? a.song)}`;
    case 'sound': return `Sound ${n('sound', a.bits)}`;
    case 'cutscene': return `Cutscene ${n('cutscene', a.cutscene)}`;
    case 'shake': return 'Shake the screen';
    case 'warp': return `Warp to ${n('level', a.custom ? `c:${a.custom}${a.area > 1 ? `:${a.area}` : ''}` : a.level)}${a.uid ? `, out of ${n('object', a.uid)}` : ''}`;
    case 'teleport': return 'Move Mario';
    case 'shotgun': return a.on === 'take' ? 'Take the shotgun away' : 'Give Mario the shotgun';
    case 'katana': return a.on === 'take' ? 'Take the katana away' : 'Give Mario the katana';
    case 'start_race': return `Start ${n('object', a.uid)}`;
    case 'timer': return `Timer: ${a.op || 'start'}`;
    case 'wait': return `Wait ${a.seconds || 1} s`;
    case 'if': return `If ${(a.conditions || []).map((c) => describe('condition', c, names)).join(' and ') || 'always'}${a.answer ? ` (answer ${a.answer})` : ''}`;
    case 'enable_event': return `${a.on === false ? 'Turn off' : 'Turn on'} “${n('event', a.event)}”`;
    case 'finish_level': return 'Finish the level';
    case 'ending': return 'Play the ending';
    default: return a.type;
  }
}

// The vocabulary as text, for Claude's tool descriptions.
export function schemaText() {
  const f = (o) => Object.entries(o).map(([k, v]) => `${k} {${v.fields.map((x) => x[0]).join(', ')}}: ${v.label}`).join('; ');
  return `TRIGGERS: ${f(TRIGGERS)}. CONDITIONS: ${f(CONDITIONS)}. ACTIONS: ${f(ACTIONS)}; if {conditions, answer?, then, else}. CUTSCENE STEPS: ${f(STEPS)}.`;
}
