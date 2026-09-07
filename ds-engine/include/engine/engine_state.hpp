#pragma once

#include "domain/assignment.hpp"
#include "domain/domain_event.hpp"
#include "domain/emergency.hpp"
#include "domain/response_team.hpp"
#include "graph/city_graph.hpp"
#include "services/emergency_scheduler.hpp"
#include "structures/hash_table.hpp"
#include "structures/linked_list.hpp"
#include "structures/queue.hpp"

namespace emergency {

struct HistoryEntry {
    std::int64_t timestamp{};
    std::string message;
};

struct EngineState {
    HashTable<std::string, ResponseTeam> teamsById;
    HashTable<std::string, Emergency> emergenciesById;
    HashTable<std::string, Assignment> assignmentsById;
    CityGraph cityGraph;
    EmergencyScheduler pendingEmergencyHeap;
    Queue<DomainEvent> incomingEventQueue;
    LinkedList<HistoryEntry> emergencyHistory;
};

}  // namespace emergency
