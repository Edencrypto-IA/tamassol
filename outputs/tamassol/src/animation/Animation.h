#pragma once

#include <stdint.h>

namespace tamassol {

enum class AnimationId : uint8_t { Sleep = 0, Happy = 1, Angry = 2 };

inline AnimationId nextAnimation(AnimationId id) {
  switch (id) {
    case AnimationId::Sleep: return AnimationId::Happy;
    case AnimationId::Happy: return AnimationId::Angry;
    case AnimationId::Angry: return AnimationId::Sleep;
  }
  return AnimationId::Sleep;
}

inline AnimationId previousAnimation(AnimationId id) {
  switch (id) {
    case AnimationId::Sleep: return AnimationId::Angry;
    case AnimationId::Happy: return AnimationId::Sleep;
    case AnimationId::Angry: return AnimationId::Happy;
  }
  return AnimationId::Sleep;
}

inline const char* animationLabel(AnimationId id) {
  switch (id) {
    case AnimationId::Sleep: return "SLEEP";
    case AnimationId::Happy: return "HAPPY";
    case AnimationId::Angry: return "ANGRY";
  }
  return "SLEEP";
}

}  // namespace tamassol
