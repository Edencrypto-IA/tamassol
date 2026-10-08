#pragma once

#include <stdint.h>

namespace tamassol {

// Logical pressed input, independent of electrical polarity and GPIO access.
class DebouncedButton {
 public:
  explicit DebouncedButton(uint16_t debounceMs = 30)
      : debounceMs_(debounceMs) {}

  void begin(bool pressed, uint32_t now) {
    rawPressed_ = pressed;
    stablePressed_ = pressed;
    changedAt_ = now;
    initialized_ = true;
  }

  // One event per stable press. A button held during begin() emits no event.
  bool update(bool pressed, uint32_t now) {
    if (!initialized_) {
      begin(pressed, now);
      return false;
    }
    if (pressed != rawPressed_) {
      rawPressed_ = pressed;
      changedAt_ = now;
    }
    if (rawPressed_ != stablePressed_ &&
        static_cast<uint32_t>(now - changedAt_) >= debounceMs_) {
      stablePressed_ = rawPressed_;
      return stablePressed_;
    }
    return false;
  }

  bool pressed() const { return stablePressed_; }
 private:
  const uint16_t debounceMs_;
  bool initialized_ = false;
  bool rawPressed_ = false;
  bool stablePressed_ = false;
  uint32_t changedAt_ = 0;
};

}  // namespace tamassol
