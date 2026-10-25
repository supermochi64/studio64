// The game's state: people (actors), vehicles, the player, money, gangs.
#pragma once
#include "common.h"
#include "render.h"

#define MAX_ACTORS 30
#define MAX_VEHICLES 16
#define MAX_RECRUITS 4

typedef struct Actor Actor;
typedef struct Vehicle Vehicle;

// ---- weapons (weapon.c has the table) ----
enum { W_FIST, W_BAT, W_PISTOL, W_SMG, W_SHOTGUN, W_RIFLE, W_LAUNCHER, W_COUNT };

// ---- people ----
enum { AK_PLAYER, AK_CIVILIAN, AK_GANG, AK_COP };
enum { GANG_NONE, GANG_PALM, GANG_VIOLET, GANG_GOLD, GANG_COPS, GANG_COUNT };

enum {
  ST_IDLE, ST_RUN, ST_SKID, ST_CROUCH, ST_CROUCHSLIDE, ST_PUNCH, ST_LAND, ST_GPLAND, ST_BELLYSLIDE,
  ST_JUMP, ST_LONGJUMP, ST_BACKFLIP, ST_SIDEFLIP, ST_FALL, ST_WALLHIT, ST_WALLKICK, ST_GPSPIN, ST_GPFALL,
  ST_DIVE, ST_AIRKICK, ST_KNOCKED, ST_DOWN, ST_GETUP, ST_DEAD, ST_SWIM, ST_VEHICLE, ST_ENTER, ST_EXIT,
  ST_LEDGE, ST_LEDGECLIMB, ST_POLE, ST_SLIDEKICK, ST_SWEEP, ST_CRAWL, ST_BUTTSLIDE, ST_HARDLAND, ST_DANCE, ST_HURT,
  ST_COUNT
};
#define ST_IS_AIR(s) ((s) >= ST_JUMP && (s) <= ST_KNOCKED)

// what a brain (the player's pad, or the AI) asks a person to do this step
typedef struct {
  V3 move;              // the wanted direction on the ground, length 0..1
  bool sprint, walk;    // (AI) speed limits
  bool jump, jumpHeld, crouch, crouchPressed, attack, attackHeld;
  float rawX, rawY;     // the stick itself (swimming steers like a tank: turn and pitch)
  bool aim;             // hold to aim (strafe, face aimAt)
  V3 aimAt;
  bool face;            // turn to faceYaw (AI standing still)
  float faceYaw;
} Controls;

typedef struct {
  color_t skin, shirt, shirt2, pants, shoes, hair, hat;
  bool hasHat, beard, glasses;
  uint8_t hairStyle;    // 0 short, 1 afro, 2 long, 3 bald
  float height, width;  // scale
  float voice;          // pitch of their voice
} Look;
#define NBONES 15
typedef struct { float x[NBONES], y[NBONES], z[NBONES]; float hipY; } Pose;

struct Actor {
  bool used;
  uint8_t kind, gang, brain;
  Look look;
  V3 pos, vel;          // vel.x/z: the horizontal velocity this step (from yaw/speed or strafing)
  float yaw, speed;     // facing, and the speed along it
  int state; float stateTime;
  int jumpType;         // 1..3 for the jump chain
  float landTime;       // time since landing (the jump chain's window)
  float peakY;          // the highest point of the current fall (fall damage)
  bool onGround, shortHop, firedInAir;
  V3 wallNormal;
  float sideVel;        // sideways drift in the air (the stick across the facing)
  float pitch;          // swimming: nose up (+) or down (-)
  float stroke;         // swimming: time left in a breaststroke
  int chain;            // the jump chain: what the last landing allows (0 single, 1 double, 2 triple)
  float grabCool;       // no grabbing ledges and poles for a moment after letting go
  V3 kickNormal;        // the wall hit (a wall kick goes off it)
  bool skidTurn;        // a skid: turning round (true) or braking (false)
  float dryTime;        // swimming: time since the head was last above water
  float health, armor, hurt;  // hurt: red flash, decays
  int combo;            // the punch combo stage (0..2)
  float hitTimer;       // a melee hit can land in this window
  float flip, roll;     // body rotation for flips and dives (radians)
  float animPhase, animBlend;
  // weapons
  int weapon;           // W_*
  int ammo[W_COUNT];    // rounds in reserve
  int clip[W_COUNT];    // in the magazine
  uint16_t weapons;     // bit per weapon carried
  float fireTimer, reloadTimer, muzzle;
  int target;           // (player) the locked-on actor, -1
  // vehicles
  Vehicle *vehicle; int seat;
  float enterTimer;
  // AI (ai.c)
  int node, prevNode;   // the sidewalk node it walks to
  int foe;              // the actor it fights, -1
  float think, alert, fear, timer2;
  V3 goal, home;
  bool recruited, hostile, scared, warrior; // warrior: an attacker in a gang war
  int followSlot;
  Controls ctl;
  // drawing
  T3DSkeleton skel;
  bool hero;            // the player's own model
  Pose pose;            // the pose shown (blends toward the state's pose)
  surface_t palette;    // the person's colours (an 8x4 texture)
  float squash;         // landing squash / jump stretch (1 = none)
  float idleTime, pushTime, poleAngle, poleTop, ledgeY;
  V3 polePos, ledgeAt;
  float sayTimer;
  float despawnTimer;
  int id;
};

// ---- vehicles ----
enum { VK_CAR, VK_BIKE };
typedef struct {
  const char *name, *model;
  uint8_t kind;              // VK_*
  float len, wid, height;    // collision box (full size)
  float maxSpeed, accel, brake, steer, grip, mass;
  int seats; float health;
  color_t paint;             // default paint (0 alpha: random)
  bool police, motor;
} VehicleDef;

struct Vehicle {
  bool used;
  int def;
  V3 pos, vel;
  float yaw, yawVel, pitch, roll, lean;
  float speed;               // along the heading
  float steer, throttle;     // the current inputs
  bool handbrake, onGround, siren, horn;
  float wheelSpin, airTime;
  float health; bool burning, wrecked; float burnTimer;
  Actor *seat[4];
  color_t paint, paint2;
  // AI driving
  int edge, fromNode, toNode; float laneSide; bool aiDriven, panic, parked;
  float stuck, honk, despawnTimer;
  T3DSkeleton skel;
  int id;
};

typedef struct {
  Actor actors[MAX_ACTORS];
  Vehicle vehicles[MAX_VEHICLES];
  Actor *player;
  int money;
  int wanted;            // 0..5 stars
  float wantedPoints, wantedCool;
  int recruits[MAX_RECRUITS];
  int respect;
  float time;            // seconds played
  float deadTimer;       // after the player dies or is arrested
  int deadKind;          // 1 dead, 2 arrested
  int war;               // a gang war in this block (0 none, else block+1)
  int warWave, warLeft; float warTimer;
  char message[64]; float messageTime;
  char bigMessage[32]; float bigTime;
  uint32_t frame;
} Game;
extern Game g;

// models shared by the modules (main.c loads them)
typedef struct {
  T3DModel *hero, *person, *personFar, *shadow, *fxCube, *fxFlash, *fxTracer, *marker;
  T3DModel *weapon[W_COUNT];
  T3DModel *pickHealth, *pickArmor, *pickCash;
  T3DModel *vehicle[16];
} Models;
extern Models g_models;

void game_message(const char *fmt, ...);
void game_big(const char *text);
