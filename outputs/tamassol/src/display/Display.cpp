#include "Display.h"
#include "BoardConfig.h"
#include "animation/Celebration.h"
#include "mascot/generated/SolflameFrames.h"
#include <esp_heap_caps.h>
#include <cstring>

namespace tamassol {
bool Display::begin() {
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, !TFT_BACKLIGHT_ON);
  lcd_.init();
  lcd_.setRotation(board::kRotation);
  lcd_.invertDisplay(true);
  lcd_.setSwapBytes(true); // Generated arrays hold native RGB565 numeric values.
  if (lcd_.width() != board::kWidth || lcd_.height() != board::kHeight) {
    Serial.println("ERROR: LCD logical dimensions are not 320x240");
    return false;
  }
  frameBuffer_ = static_cast<uint16_t*>(
      heap_caps_malloc(kFrameBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  psramBuffer_ = frameBuffer_ != nullptr;
  if (!frameBuffer_) {
    frameBuffer_ = static_cast<uint16_t*>(
        heap_caps_malloc(kFrameBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  }
  if (!frameBuffer_) {
    Serial.println("ERROR: cannot allocate the 34 KiB frame buffer");
    return false;
  }
  lcd_.fillScreen(0x0862); // RGB565(#080C14), same as pre-composited assets.
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
  return true;
}

void Display::drawBackground() {
  lcd_.pushImage(0, 0, board::kWidth, board::kHeight, assets::kLandscape);
}

void Display::drawFrame(const uint16_t* pixels, const uint8_t* mask, int16_t x, int16_t y, uint32_t celebrationMs, IdlePose pose,uint8_t celebrationVariant,const uint16_t* eyeFrame) {
  if (!frameBuffer_ || !pixels || !mask) return;
  if (x < 0 || y < 8 || x + 128 > board::kWidth || y + 128 > board::kHeight) return;
  // Restore only the dirty rectangle, then composite the 1-bit sprite mask.
  // No screen readback, full-screen RAM buffer, allocations or PNG decoding.
  for (uint16_t row = 0; row < 136; ++row) {
    std::memcpy(frameBuffer_ + row * 128,
                assets::kLandscape + (y - 8 + row) * board::kWidth + x, 256);
  }
  if(celebrationMs<kCelebrationDuration) composeMascot(frameBuffer_,pixels,mask,celebrationMs,celebrationVariant);
  else composeIdle(frameBuffer_,pixels,mask,pose.calmEyes?eyeFrame:assets::kSleep.frames[0],pose);
  lcd_.pushImage(x, y-8, 128, 136, frameBuffer_);
}
} // namespace tamassol
