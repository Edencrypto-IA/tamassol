// Generated RGB565 words + LSB-first 1-bit opacity masks, stored in flash.
#pragma once
#include <cstdint>
namespace tamassol { namespace assets {
constexpr uint16_t kWidth=128, kHeight=128;
struct FrameSet { const uint16_t* const* frames; const uint8_t* const* masks; uint16_t count; };
extern const FrameSet kSleep, kHappy, kAngry;
extern const uint16_t kLandscape[320*240];
}}
