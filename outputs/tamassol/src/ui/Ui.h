#pragma once
#include "animation/Animation.h"
#include "display/Display.h"
#include "diagnostics/Microphone.h"
#include "pairing/Pairing.h"
#include "online/DataHealth.h"

namespace tamassol {
class Ui {
 public:
  explicit Ui(Display& display) : display_(display) {}
  void begin();
  void drawWallet();
  void drawAccount();
  void setBalance(uint64_t lamports, uint32_t receivedAt);
  void toggleReceive();
  void drawPrice(double usd, double change24h, uint32_t receivedAt);
  void drawConnection(bool connected, bool verified, uint32_t now);
  void showSpark(uint64_t lamports);
  void clearSpark();
  void drawVoice(VoiceUi state, uint32_t now);
  void drawPairing(const PairingView& view, bool celebrating);
 private:
  Display& display_;
  uint64_t balance_=0;
  bool balanceValid_=false;
  bool receiving_=false;
  double price_=0;
  VoiceUi voice_=VoiceUi::Idle;
  uint32_t voiceFrame_=UINT32_MAX;
  PairingView link_{};
  bool linkHeaderDirty_=true;
  uint32_t priceAt_=0, balanceAt_=0;
  uint8_t healthCode_=255;
};
} // namespace tamassol

