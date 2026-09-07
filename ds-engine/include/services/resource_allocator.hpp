#pragma once

#include <optional>
#include <string>
#include "domain/emergency.hpp"
#include "domain/response_team.hpp"
#include "structures/hash_table.hpp"

namespace emergency {

struct AllocationDecision {
    bool allocated{false};
    std::string teamId;
    double distanceKm{};
    std::string reason;
};

class ResourceAllocator {
public:
    [[nodiscard]] AllocationDecision selectNearestAvailableTeam(
        const Emergency& emergency, const HashTable<std::string, ResponseTeam>& teams) const;
    [[nodiscard]] static double haversineKm(GeoPoint from, GeoPoint to);
};

}  // namespace emergency
