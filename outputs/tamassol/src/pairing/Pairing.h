#pragma once
#include <stdint.h>
#include "PairingState.h"
namespace tamassol {
struct PairingView {
  bool available=false, bound=false, online=false;
  PairingState::Pending pending=PairingState::Pending::None;
  char fingerprint[17]{};
  uint32_t generation=0;
};
void beginPairing();
// Commands accepted ONLY from existing local USB diagnostic parser. No network server.
bool pairingCommand(const char* command);
bool pollPairing(PairingView& view);
void confirmPairing(const PairingView& shown);
bool pairingPending();
} // namespace tamassol
