#include <assert.h>
#include "../src/input/ButtonGesture.h"
using tamassol::ButtonGesture;
using E=ButtonGesture::Event;
int main() {
  ButtonGesture b;
  b.begin(false,0);
  assert(b.update(true,100)==E::None);
  assert(b.update(true,130)==E::None);
  assert(b.update(false,300)==E::None);
  assert(b.update(false,330)==E::Short);
  assert(b.update(false,500)==E::None);
  b.update(true,1000); b.update(true,1030);
  assert(b.update(true,3000)==E::None);
  b.update(false,3100);
  assert(b.update(false,3130)==E::Long);
  assert(b.update(false,3200)==E::None);
  b.begin(true,0);
  b.update(false,2000);
  assert(b.update(false,2030)==E::None); // Held during boot is ignored.
  b.begin(false,0);
  b.update(true,10); b.update(false,20);
  assert(b.update(false,60)==E::None); // Bounce.
  b.begin(false,UINT32_MAX-1000);
  b.update(true,UINT32_MAX-900); b.update(true,UINT32_MAX-870);
  b.update(false,100);
  assert(b.update(false,130)==E::Long); // Clock rollover.
}
