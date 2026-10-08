#pragma once
#include <stdint.h>
namespace tamassol {
enum class VoiceUi : uint8_t { Idle, Listening, Processing, Confirm,
  Success, Cancelled, Expired, Error, Pending, Recognized, Sending, Request, PcOffline };
inline VoiceUi visibleVoiceState(VoiceUi state,uint32_t elapsed) {
  if (state==VoiceUi::Idle) return state;
  if (state==VoiceUi::Request)
    return elapsed<10000U?state:elapsed<18000U?VoiceUi::PcOffline:VoiceUi::Idle;
  if (state==VoiceUi::Sending)
    return elapsed<120000U?state:elapsed<128000U?VoiceUi::Pending:VoiceUi::Idle;
  if (state==VoiceUi::Confirm)
    return elapsed<60000U?state:elapsed<68000U?VoiceUi::Expired:VoiceUi::Idle;
  if (state==VoiceUi::Listening || state==VoiceUi::Processing)
    return elapsed<90000U?state:elapsed<98000U?VoiceUi::Error:VoiceUi::Idle;
  return elapsed<8000U?state:VoiceUi::Idle;
}
}
