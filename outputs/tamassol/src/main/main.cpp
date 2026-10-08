#include <Arduino.h>
#include "BoardConfig.h"
#include "display/Display.h"
#include "input/Input.h"
#include "mascot/Mascot.h"
#include "ui/Ui.h"
#include "online/Online.h"
#include "animation/MoodSchedule.h"
#include "animation/Celebration.h"
#include "diagnostics/Microphone.h"
#include "pairing/Pairing.h"
#include "veil/VeilApproval.h"

namespace {
tamassol::Display display;
tamassol::Input input;
tamassol::Mascot mascot(display);
tamassol::Ui ui(display);
tamassol::Online online;
tamassol::PairingView linkView;
bool celebrating = false;
uint32_t celebrationStarted = 0;
tamassol::MoodSchedule mood;
bool ready = false;
uint32_t lastStats = 0;
uint32_t drawnFrames = 0;
uint32_t worstDrawUs = 0;

void printMemory() {
  Serial.printf("heap=%u free=%u min=%u; PSRAM=%u free=%u; flash=%u sketch=%u\n",
                ESP.getHeapSize(), ESP.getFreeHeap(), ESP.getMinFreeHeap(),
                ESP.getPsramSize(), ESP.getFreePsram(), ESP.getFlashChipSize(),
                ESP.getSketchSize());
}
}

void setup() {
  Serial.setTxBufferSize(2048);
  Serial.begin(115200); // Never wait for a serial monitor.
  Serial.println("TAMASSOL v0.9 DEVNET / FNK0104A / ILI9341_2 / living behaviors");
  input.begin(millis());
  ready = display.begin();
  if (!ready) return;
  mood.begin(millis(),esp_random());
  mascot.setAnimation(tamassol::AnimationId::Sleep);
  ui.begin();
  mascot.draw();
  Serial.printf("LCD=%ux%u rotation=%u; BOOT=GPIO0; frameBuffer=%u (%s)\n",
                tamassol::board::kWidth, tamassol::board::kHeight,
                tamassol::board::kRotation,
                static_cast<unsigned>(tamassol::Display::kFrameBytes),
                display.usesPsram() ? "PSRAM" : "internal RAM fallback");
  printMemory();
  lastStats = millis();
  online.begin();
  tamassol::beginPairing();
  tamassol::beginVeilApproval(display);
}

void loop() {
  tamassol::pollMicrophoneDiagnostic(); // Disabled unless serial MIC TEST is requested.
  if (!ready) { yield(); return; }
  const uint32_t now = millis();
  static bool veilOwned=false;
  if(tamassol::veilActive() || veilOwned) {
    veilOwned=tamassol::pollVeilApproval(input.update(now));
    if(!veilOwned) ui.begin();
    yield();return;
  }
  tamassol::pollPairing(linkView);
  const bool linkPending=linkView.pending!=tamassol::PairingState::Pending::None;
  if(!linkPending) ui.drawVoice(tamassol::voiceUiState(),now);
  const tamassol::InputEvent event = input.update(now);
  if (event==tamassol::InputEvent::Voice && !linkPending) tamassol::requestVoiceCapture();
  if (event==tamassol::InputEvent::Next) {
    if(linkPending) tamassol::confirmPairing(linkView);
    else ui.toggleReceive();
  }
  if (celebrating && now-celebrationStarted>=tamassol::kCelebrationDuration) {
    celebrating=false;
    mascot.stopCelebration();
    ui.clearSpark();
  }
  tamassol::OnlineEvent message{};
  if (!celebrating && online.poll(message)) {
    if (message.kind==tamassol::OnlineEvent::Price) {
      ui.drawPrice(message.price,message.change24h,message.receivedAt);
      mood.setChange(message.change24h);
      Serial.println("UI market quote displayed");
    }
    else if (message.kind==tamassol::OnlineEvent::Balance) {
      ui.setBalance(message.lamports,message.receivedAt);
      Serial.println("UI DEVNET balance displayed");
    }
    else {
      celebrating=true;
      celebrationStarted=now;
      mascot.startCelebration(now);
      ui.showSpark(message.lamports);
    }
  }
  ui.drawPairing(linkView,celebrating);
  // Network timestamps can arrive after this loop's initial 'now' snapshot.
  ui.drawConnection(online.connected(),online.verified(),millis());
  const auto voice=tamassol::voiceUiState();
  auto activity=tamassol::PetActivity::Rest;
  if(!linkPending) {
    if(voice==tamassol::VoiceUi::Listening) activity=tamassol::PetActivity::Listening;
    else if(voice==tamassol::VoiceUi::Processing || voice==tamassol::VoiceUi::Request ||
            voice==tamassol::VoiceUi::Confirm || voice==tamassol::VoiceUi::Sending)
      activity=tamassol::PetActivity::Thinking;
    else if(voice==tamassol::VoiceUi::Recognized || voice==tamassol::VoiceUi::Success)
      activity=tamassol::PetActivity::Acknowledge;
  }
  mascot.setActivity(activity,now);
  const auto normal=mood.update(now,celebrating || activity!=tamassol::PetActivity::Rest);
  const auto target=activity==tamassol::PetActivity::Rest?normal:tamassol::AnimationId::Happy;
  if (mascot.animation()!=target) mascot.setAnimation(target);
  mascot.update();
  const uint32_t started = micros();
  if (mascot.draw()) {
    ++drawnFrames;
    const uint32_t duration = micros() - started;
    if (duration > worstDrawUs) worstDrawUs = duration;
  }
  const uint32_t elapsed = now - lastStats;
  if (elapsed >= 5000U && !tamassol::microphoneBusy()) {
    Serial.printf("state=%s target=%.1ffps measured=%.2ffps worstBlit=%uus\n",
                  tamassol::animationLabel(mascot.animation()),
                  mascot.targetFps(),
                  drawnFrames * 1000.0 / elapsed, static_cast<unsigned>(worstDrawUs));
    printMemory();
    lastStats = now;
    drawnFrames = 0;
    worstDrawUs = 0;
  }
  yield(); // Return CPU to the RTOS; no animation delay or busy waiting.
}
