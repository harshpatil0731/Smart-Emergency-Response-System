#pragma once

#include <cstdint>
#include <string>
#include "domain/enums.hpp"
#include "domain/geo_point.hpp"

namespace emergency {

struct Emergency {
    std::string id;
    EmergencyType type{EmergencyType::OTHER};
    EmergencyPriority priority{EmergencyPriority::LOW};
    int severity{};
    int injuredCount{};
    GeoPoint location{};
    std::string destinationGraphNodeId;
    EmergencyStatus status{EmergencyStatus::PENDING};
    std::int64_t createdAt{};
    std::int64_t updatedAt{};
};

}  // namespace emergency
