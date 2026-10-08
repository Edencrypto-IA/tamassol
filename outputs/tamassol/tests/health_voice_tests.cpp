#include <assert.h>
#include <initializer_list>
#include "../src/online/DataHealth.h"
#include "../src/diagnostics/VoiceState.h"
using namespace tamassol;
int main() {
  assert(freshness(false,true,0,0,90000)==Freshness::Missing);
  assert(freshness(true,true,89999,0,90000)==Freshness::Fresh);
  assert(freshness(true,true,90000,0,90000)==Freshness::Stale);
  assert(freshness(true,false,1,0,90000)==Freshness::Stale);
  assert(freshness(true,true,20,UINT32_MAX-20,90000)==Freshness::Fresh);
  assert(freshness(true,true,419999,0,kPriceMaxAgeMs)==Freshness::Fresh);
  assert(freshness(true,true,420000,0,kPriceMaxAgeMs)==Freshness::Stale);
  assert(visibleVoiceState(VoiceUi::Confirm,59999)==VoiceUi::Confirm);
  assert(visibleVoiceState(VoiceUi::Confirm,60000)==VoiceUi::Expired);
  assert(visibleVoiceState(VoiceUi::Confirm,68000)==VoiceUi::Idle);
  assert(visibleVoiceState(VoiceUi::Processing,90000)==VoiceUi::Error);
  assert(visibleVoiceState(VoiceUi::Processing,98000)==VoiceUi::Idle);
  assert(visibleVoiceState(VoiceUi::Sending,119999)==VoiceUi::Sending);
  assert(visibleVoiceState(VoiceUi::Sending,120000)==VoiceUi::Pending);
  assert(visibleVoiceState(VoiceUi::Sending,128000)==VoiceUi::Idle);
  assert(visibleVoiceState(VoiceUi::Request,9999)==VoiceUi::Request);
  assert(visibleVoiceState(VoiceUi::Request,10000)==VoiceUi::PcOffline);
  assert(visibleVoiceState(VoiceUi::Request,18000)==VoiceUi::Idle);
  for(auto s:{VoiceUi::Success,VoiceUi::Cancelled,VoiceUi::Expired,
              VoiceUi::Error,VoiceUi::Pending,VoiceUi::Recognized}) {
    assert(visibleVoiceState(s,7999)==s);
    assert(visibleVoiceState(s,8000)==VoiceUi::Idle);
  }
}
