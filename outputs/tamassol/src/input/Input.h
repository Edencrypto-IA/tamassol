#pragma once
#include "DebouncedButton.h"
#include "ButtonGesture.h"
#include "BoardConfig.h"
#include <stdint.h>

namespace tamassol {
enum class InputEvent : uint8_t { None, Next, Previous, Confirm, Voice };
class Input {
 public:
  void begin(uint32_t now);
  InputEvent update(uint32_t now);
 private:
  ButtonGesture next_{board::kDebounceMs};
  DebouncedButton previous_{board::kDebounceMs};
  DebouncedButton confirm_{board::kDebounceMs};
};
} // namespace tamassol
