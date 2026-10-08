#pragma once
#include "DebouncedButton.h"
namespace tamassol {
// Emit on release: short press keeps its old action, long press requests voice.
class ButtonGesture {
 public:
  enum class Event { None, Short, Long };
  explicit ButtonGesture(uint16_t debounce=30):button_(debounce) {}
  void begin(bool pressed,uint32_t now) { button_.begin(pressed,now); armed_=false; }
  Event update(bool pressed,uint32_t now) {
    const bool wasPressed=button_.pressed();
    if (button_.update(pressed,now)) { armed_=true; started_=now; }
    if (wasPressed && !button_.pressed() && armed_) {
      armed_=false;
      return uint32_t(now-started_)>=700U?Event::Long:Event::Short;
    }
    return Event::None;
  }
 private:
  DebouncedButton button_;
  bool armed_=false;
  uint32_t started_=0;
};
}
