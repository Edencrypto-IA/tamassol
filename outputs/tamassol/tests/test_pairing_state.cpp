#include "../src/pairing/PairingState.h"
#include <cassert>
#include <cstdio>
using tamassol::PairingState;
int main() {
  PairingState s; s.begin(false);
  assert(!s.bound()&&!s.online()&&!s.challenge(0)&&!s.proof(true,0));
  assert(!s.request(true,0));
  assert(s.request(false,10));
  assert(!s.request(false,20)); // Cannot replace request while user reads screen.
  assert(!s.canConfirm(999)); assert(s.canConfirm(1010));
  s.cancel(); assert(!s.canConfirm(2000)); s.committed(); assert(!s.bound());
  assert(s.request(false,2000)); s.tick(62000); assert(!s.canConfirm(62000));
  assert(s.request(false,63000)); assert(s.canConfirm(64000)); s.committed();
  assert(s.bound()&&!s.online()); assert(!s.request(false,65000));
  assert(s.challenge(65000)); assert(!s.challenge(65001));
  assert(!s.proof(false,65002)); assert(!s.proof(true,65003)); // Invalid proof consumes nonce.
  assert(s.challenge(66000)); assert(s.proof(true,66001));
  assert(s.online()); assert(!s.proof(true,66002)); // Replay.
  s.tick(96001); assert(!s.online()&&s.bound());
  assert(s.challenge(97000)); assert(!s.proof(true,107000)); // Exact expiry.
  assert(s.challenge(108000)); s.disconnect(); assert(!s.proof(true,108001));
  assert(s.request(true,109000)); assert(!s.challenge(110000));
  assert(s.canConfirm(110000)); s.committed(); assert(!s.bound());
  s.begin(false); assert(s.request(false,UINT32_MAX-499));
  assert(!s.canConfirm(100)); assert(s.canConfirm(501));
  s.tick(59500); assert(!s.canConfirm(59500)); // Pending expiry across wrap.
  s.begin(true); assert(s.challenge(UINT32_MAX-10)); assert(s.proof(true,5));
  s.tick(30005); assert(!s.online());
  puts("Pairing state: 34 assertions PASS");
}
