#include "services/resource_allocator.hpp"

#include <cmath>
#include <limits>
#include "services/resource_compatibility.hpp"

namespace emergency {

double ResourceAllocator::haversineKm(GeoPoint from, GeoPoint to) {
    constexpr double pi = 3.14159265358979323846;
    constexpr double earthRadiusKm = 6371.0;
    const auto radians = [pi](double degrees) { return degrees * pi / 180.0; };
    const double dLat = radians(to.latitude - from.latitude);
    const double dLon = radians(to.longitude - from.longitude);
    const double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
                     std::cos(radians(from.latitude)) * std::cos(radians(to.latitude)) *
                     std::sin(dLon / 2) * std::sin(dLon / 2);
    return earthRadiusKm * 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
}

AllocationDecision ResourceAllocator::selectNearestAvailableTeam(
    const Emergency& emergency, const HashTable<std::string, ResponseTeam>& teams) const {
    AllocationDecision best; best.reason = "No compatible AVAILABLE response team";
    double bestDistance = std::numeric_limits<double>::infinity();
    teams.forEach([&](const std::string&, const ResponseTeam& team) {
        if (team.status != TeamStatus::AVAILABLE || !ResourceCompatibility::isCompatible(emergency.type, team.type)) return;
        const double distance = haversineKm(team.currentLocation, emergency.location);
        if (!best.allocated || distance < bestDistance || (distance == bestDistance && team.id < best.teamId)) {
            best.allocated = true; best.teamId = team.id; best.distanceKm = distance; bestDistance = distance; best.reason.clear();
        }
    });
    return best;
}

}  // namespace emergency
