#include "AnimationPlayer.h"

namespace tamassol {

void AnimationPlayer::start(AnimationId id, uint16_t frameCount,
                            uint16_t frameMs, uint32_t now) {
  animation_ = id;
  frameCount_ = frameCount ? frameCount : 1;
  frameMs_ = frameMs ? frameMs : 1;
  frame_ = 0;
  lastFrameAt_ = now;
}

bool AnimationPlayer::update(uint32_t now) {
  // Unsigned subtraction also handles the normal millis() rollover.
  const uint32_t elapsed = now - lastFrameAt_;
  const uint32_t steps = elapsed / frameMs_;
  if (!steps) return false;

  // Preserve the fractional interval; catch up without a loop or frame drift.
  lastFrameAt_ += steps * frameMs_;
  const uint32_t advance = steps % frameCount_;
  frame_ = static_cast<uint16_t>((frame_ + advance) % frameCount_);
  return true;
}

}  // namespace tamassol
