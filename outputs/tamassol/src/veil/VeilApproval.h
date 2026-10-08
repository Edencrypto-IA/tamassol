#pragma once
#include "display/Display.h"
#include "input/Input.h"
namespace tamassol {
void beginVeilApproval(Display& display);
void veilCommand(const char* command);
bool veilActive();
bool pollVeilApproval(InputEvent event); // true means overlay owns screen/input
}
