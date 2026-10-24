// Cars and bikes: one table (add a row for a new vehicle), arcade driving physics, crashes, damage,
// fire and explosions, getting in and out (and pulling drivers out), the riders' seats.
#pragma once
#include "game.h"

enum { VD_SEDAN, VD_LOWRIDER, VD_PICKUP, VD_VAN, VD_SPORTS, VD_POLICE, VD_TAXI, VD_BMX, VD_MOTOR, VD_COUNT };
extern const VehicleDef g_vdefs[VD_COUNT];

void vehicle_init(void);
Vehicle *vehicle_spawn(int def, V3 pos, float yaw);
void vehicle_free(Vehicle *v);
void vehicle_step(Vehicle *v);
void vehicle_collide_all(void);
void vehicle_draw(Vehicle *v);
static inline bool vehicle_is_bike(const Vehicle *v) { return g_vdefs[v->def].kind == VK_BIKE; }
static inline Actor *vehicle_driver(const Vehicle *v) { return v->seat[0]; }
bool vehicle_shows_rider(const Vehicle *v);
void vehicle_rider_matrix(Vehicle *v, Actor *a, T3DMat4 *out);
V3 vehicle_door(const Vehicle *v, int seat);

// people and seats
Vehicle *vehicle_nearest(V3 pos, float maxDist, int *seat, bool driverSeat);
bool vehicle_enter(Actor *a, Vehicle *v, int seat);   // walks to the door (pulls a driver out)
void vehicle_exit(Actor *a);                          // gets out at the door
void vehicle_leave(Vehicle *v, Actor *a, bool thrown);// out at once (thrown: flies off, a crash)
void vehicle_board_step(Actor *a);                    // ST_ENTER / ST_EXIT
int vehicle_free_seat(const Vehicle *v, bool passenger);

// hits
bool vehicle_raycast(const Vehicle *v, V3 o, V3 d, float range, float *t);
void vehicle_damage(Vehicle *v, float dmg, V3 at, Actor *by);
void vehicle_push(Vehicle *v, V3 vel, float up);
void vehicle_melee(V3 c, float r, float dmg, V3 dir, Actor *by);

// the AI's driving (traffic, police): sets steer/throttle from the street network
void vehicle_ai_drive(Vehicle *v);
void vehicle_ai_start(Vehicle *v);   // put it on the nearest lane
extern Actor *g_chase_target;        // police cars drive at this one
