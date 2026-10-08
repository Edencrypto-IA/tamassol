#pragma once
#include "Animation.h"
#include <cmath>
namespace tamassol {
// No allocations, blocking waits or wall-clock dependence. millis rollover safe.
class MoodSchedule {
 public:
  void begin(uint32_t now,uint32_t seed=1) {
    rng_=seed?seed:1; cycle_=now; awakeFor_=between(100000,180000);
    nap_=reacting_=quoted_=pending_=false; lastReaction_=now;
    resetPersonality(now);
  }
  void setChange(double change) {
    if(!std::isfinite(change)) return;
    if(!quoted_) { anchor_=change; quoted_=true; return; }
    latest_=change; pending_=true;
  }
  AnimationId update(uint32_t now,bool interaction) {
    if(interaction) {
      nap_=reacting_=pending_=false; cycle_=now;
      if(!interacting_) resetPersonality(now);
      interacting_=true; personalityAt_=now;
      return AnimationId::Happy;
    }
    interacting_=false;
    if(nap_) {
      pending_=false;
      if(uint32_t(now-cycle_)<30000U) return AnimationId::Sleep;
      nap_=false; cycle_=now; awakeFor_=between(100000,180000);
      resetPersonality(now);
    }
    if(uint32_t(now-cycle_)>=awakeFor_) {
      nap_=true; cycle_=now; reacting_=pending_=false;
      return AnimationId::Sleep;
    }
    if(reacting_ && uint32_t(now-lastReaction_)>=reactionFor_) {
      reacting_=false; resetPersonality(now);
    }
    if(pending_) {
      pending_=false;
      // Significant movement of the 24h indicator, not every price poll.
      if(!reacting_ && uint32_t(now-lastReaction_)>=90000U &&
         std::fabs(latest_-anchor_)>=0.5 && std::fabs(latest_)>=0.15) {
        market_=latest_<0?AnimationId::Angry:AnimationId::Happy;
        reactionFor_=market_==AnimationId::Angry?between(3000,4000):between(4000,6000);
        anchor_=latest_; lastReaction_=now; reacting_=true;
      }
    }
    if(reacting_) return market_;
    // Personal expression is independent from market direction. Existing ANGRY
    // art also serves as a short serious/attentive look, with its existing blink.
    if(uint32_t(now-personalityAt_)>=personalityFor_) {
      serious_=!serious_; personalityAt_=now;
      personalityFor_=serious_?between(3000,6000):between(8000,16000);
    }
    return serious_?AnimationId::Angry:AnimationId::Happy;
  }
 private:
  void resetPersonality(uint32_t now) {
    serious_=false; personalityAt_=now; personalityFor_=between(8000,16000);
  }
  uint32_t between(uint32_t lo,uint32_t hi) {
    rng_^=rng_<<13; rng_^=rng_>>17; rng_^=rng_<<5;
    return lo+rng_%(hi-lo+1);
  }
  uint32_t rng_=1,cycle_=0,awakeFor_=120000,lastReaction_=0,reactionFor_=0;
  double anchor_=0,latest_=0;
  bool nap_=false,reacting_=false,quoted_=false,pending_=false;
  bool serious_=false,interacting_=false;
  uint32_t personalityAt_=0,personalityFor_=10000;
  AnimationId market_=AnimationId::Happy;
};
}
