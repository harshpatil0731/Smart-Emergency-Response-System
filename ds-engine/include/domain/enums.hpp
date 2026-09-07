#pragma once

namespace emergency {

enum class TeamType { AMBULANCE, FIRE_BRIGADE, RESCUE_TEAM };
enum class TeamStatus { OFFLINE, AVAILABLE, BUSY };
enum class EmergencyType { ACCIDENT, FIRE, MEDICAL, FLOOD, BUILDING_COLLAPSE, OTHER };
enum class EmergencyPriority { CRITICAL, HIGH, MEDIUM, LOW };
enum class EmergencyStatus { PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED };
enum class RoadStatus { OPEN, BLOCKED };
enum class AssignmentStatus { OFFERED, ACCEPTED, COMPLETED, DECLINED, CANCELLED, REASSIGNMENT_REQUIRED };
enum class RouteStatus { AVAILABLE, UNREACHABLE };

}  // namespace emergency
