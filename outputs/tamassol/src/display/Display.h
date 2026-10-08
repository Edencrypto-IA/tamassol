#pragma once
#include <Arduino.h>
#include <TFT_eSPI.h>
#include "animation/IdleMotion.h"

namespace tamassol {
class Display {
 public:
  bool begin();
  void drawBackground();
  void drawFrame(const uint16_t* pixels, const uint8_t* mask, int16_t x, int16_t y, uint32_t celebrationMs=UINT32_MAX, IdlePose pose={}, uint8_t celebrationVariant=0, const uint16_t* eyeFrame=nullptr);
  TFT_eSPI& canvas() { return lcd_; }
  bool usesPsram() const { return psramBuffer_; }
  static constexpr size_t kFrameBytes = 128U * 136U * sizeof(uint16_t);
 private:
  TFT_eSPI lcd_;
  uint16_t* frameBuffer_ = nullptr;
  bool psramBuffer_ = false;
};
} // namespace tamassol
