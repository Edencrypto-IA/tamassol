#include "Input.h"
#include "BoardConfig.h"
#include <Arduino.h>

namespace tamassol {
namespace {
bool isPressed(int8_t pin) { return pin >= 0 && digitalRead(pin) == LOW; }
void initPin(int8_t pin) { if (pin >= 0) pinMode(pin, INPUT_PULLUP); }
}
void Input::begin(uint32_t now) {
  initPin(board::kNext);
  initPin(board::kPrevious);
  initPin(board::kConfirm);
  next_.begin(isPressed(board::kNext), now);
  previous_.begin(isPressed(board::kPrevious), now);
  confirm_.begin(isPressed(board::kConfirm), now);
}
InputEvent Input::update(uint32_t now) {
  const auto next = next_.update(isPressed(board::kNext), now);
  const bool previous = previous_.update(isPressed(board::kPrevious), now);
  const bool confirm = confirm_.update(isPressed(board::kConfirm), now);
  if (confirm) return InputEvent::Confirm;
  if (next==ButtonGesture::Event::Long) return InputEvent::Voice;
  if (next==ButtonGesture::Event::Short) return InputEvent::Next;
  if (previous) return InputEvent::Previous;
  return InputEvent::None;
}
} // namespace tamassol

