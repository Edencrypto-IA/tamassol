#pragma once
#include <stdint.h>

namespace tamassol {
// Transport-independent policy. All times use unsigned differences (millis wrap safe).
class PairingState {
 public:
  enum class Pending : uint8_t { None, Bind, Forget };
  static constexpr uint32_t kApprovalMs=60000, kNonceMs=10000, kOnlineMs=30000;
  void begin(bool bound) { bound_=bound; pending_=Pending::None; nonce_=online_=issued_=false; }
  bool request(bool forget, uint32_t now) {
    tick(now);
    if (pending_!=Pending::None || (forget ? !bound_ : bound_)) return false;
    pending_=forget?Pending::Forget:Pending::Bind; pendingAt_=now; return true;
  }
  void cancel() { pending_=Pending::None; }
  bool canConfirm(uint32_t now) {
    tick(now); return pending_!=Pending::None && now-pendingAt_>=1000U;
  }
  void committed() {
    if (pending_==Pending::None) return;
    bound_=pending_==Pending::Bind; pending_=Pending::None; nonce_=online_=false;
  }
  bool challenge(uint32_t now) {
    tick(now);
    if (!bound_ || pending_!=Pending::None || (issued_ && now-issuedAt_<1000U)) return false;
    issued_=true; issuedAt_=now; nonce_=true; return true;
  }
  bool hasNonce(uint32_t now) { tick(now); return nonce_ && pending_==Pending::None; }
  bool proof(bool valid, uint32_t now) {
    const bool allowed=hasNonce(now); nonce_=false; // Consume even invalid proofs.
    if (!allowed || !valid) return false;
    online_=true; onlineAt_=now; return true;
  }
  void disconnect() { online_=nonce_=false; }
  void tick(uint32_t now) {
    if (pending_!=Pending::None && now-pendingAt_>=kApprovalMs) cancel();
    if (nonce_ && now-issuedAt_>=kNonceMs) nonce_=false;
    if (online_ && now-onlineAt_>=kOnlineMs) online_=false;
  }
  bool bound() const { return bound_; }
  bool online() const { return online_; }
  Pending pending() const { return pending_; }
 private:
  bool bound_=false, nonce_=false, online_=false, issued_=false;
  Pending pending_=Pending::None;
  uint32_t pendingAt_=0, issuedAt_=0, onlineAt_=0;
};
} // namespace tamassol
