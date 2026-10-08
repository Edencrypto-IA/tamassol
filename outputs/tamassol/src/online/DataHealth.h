#pragma once
#include <stdint.h>
namespace tamassol {
enum class Freshness : uint8_t { Missing, Fresh, Stale };
inline Freshness freshness(bool valid, bool connected, uint32_t now,
                           uint32_t updated, uint32_t maxAge) {
  if (!valid) return Freshness::Missing;
  return connected && uint32_t(now-updated)<maxAge ? Freshness::Fresh : Freshness::Stale;
}
constexpr uint32_t kPriceMaxAgeMs=420000U, kBalanceMaxAgeMs=90000U;
}
