#pragma once

#include <cstdint>
#include <string>
#include "domain/enums.hpp"
#include "domain/geo_point.hpp"

namespace emergency {

struct ResponseTeam {
    std::string id;
    TeamType type{TeamType::AMBULANCE};
    TeamStatus status{TeamStatus::OFFLINE};
    GeoPoint currentLocation{};
    std::string currentGraphNodeId;
    std::string activeAssignmentId;
    std::int64_t lastUpdatedAt{};
};

}  // namespace emergency
