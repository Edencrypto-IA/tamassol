#pragma once
#include <stdint.h>
#include "VoiceState.h"
namespace tamassol {
void pollMicrophoneDiagnostic();
VoiceUi voiceUiState();
bool microphoneBusy();
void requestVoiceCapture();
}
