#pragma once

#include <cstdint>
#include <string>
#include <variant>
#include "domain/emergency.hpp"
#include "domain/enums.hpp"
#include "domain/geo_point.hpp"

namespace emergency {

struct EmergencyReported { Emergency emergency; };
struct TeamStatusChanged { std::string teamId; TeamStatus status; std::int64_t timestamp{}; };
struct TeamLocationUpdated { std::string teamId; GeoPoint location; std::string graphNodeId; std::int64_t timestamp{}; };
struct RoadStatusChanged { std::string roadId; RoadStatus status; std::int64_t timestamp{}; };
struct AssignmentAccepted { std::string assignmentId; std::int64_t timestamp{}; };
struct AssignmentDeclined { std::string assignmentId; std::int64_t timestamp{}; };
struct EmergencyCompleted { std::string emergencyId; std::int64_t timestamp{}; };

using DomainEvent = std::variant<EmergencyReported, TeamStatusChanged, TeamLocationUpdated, RoadStatusChanged,
                                 AssignmentAccepted, AssignmentDeclined, EmergencyCompleted>;

}  // namespace emergency
