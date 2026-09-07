#include <string>
#include "structures/binary_heap.hpp"
#include "structures/hash_table.hpp"
#include "structures/linked_list.hpp"
#include "structures/queue.hpp"
#include "structures/stack.hpp"
#include "services/emergency_scheduler.hpp"
#include "test_support.hpp"

namespace {
struct LowerFirst { bool operator()(int a, int b) const { return a < b; } };
struct ConstantHash { std::size_t operator()(const std::string&) const { return 0; } };

void tests() {
    emergency::LinkedList<int> list;
    list.pushBack(2); list.pushFront(1); list.pushBack(3);
    require(list.size() == 3, "linked list size");
    require(list.find([](int value) { return value == 2; }) != nullptr, "linked list search");
    require(list.removeFirst([](int value) { return value == 2; }), "linked list deletion");
    require(list.size() == 2, "linked list size after deletion");

    emergency::Queue<int> queue;
    queue.enqueue(10); queue.enqueue(20);
    require(queue.dequeue().value() == 10 && queue.dequeue().value() == 20 && queue.empty(), "queue FIFO ordering");

    emergency::Stack<int> stack;
    stack.push(10); stack.push(20);
    require(stack.pop().value() == 20 && stack.pop().value() == 10 && stack.empty(), "stack LIFO ordering");

    emergency::HashTable<std::string, int, ConstantHash> table(3);
    require(table.insert("A", 1) && table.insert("B", 2), "hash insert with collision");
    table.upsert("B", 22);
    require(*table.find("B") == 22 && table.erase("A") && !table.contains("A"), "hash lookup/update/delete");

    emergency::BinaryHeap<int, LowerFirst> heap;
    heap.push(4); heap.push(1); heap.push(3); heap.push(2);
    require(heap.pop().value() == 1 && heap.pop().value() == 2 && heap.pop().value() == 3 && heap.pop().value() == 4, "binary heap ordering");

    emergency::Emergency low{"E3", emergency::EmergencyType::OTHER, emergency::EmergencyPriority::LOW, 0, 0, {}, "", emergency::EmergencyStatus::PENDING, 3, 3};
    emergency::Emergency criticalLater{"E2", emergency::EmergencyType::OTHER, emergency::EmergencyPriority::CRITICAL, 0, 0, {}, "", emergency::EmergencyStatus::PENDING, 2, 2};
    emergency::Emergency criticalEarlier{"E1", emergency::EmergencyType::OTHER, emergency::EmergencyPriority::CRITICAL, 0, 0, {}, "", emergency::EmergencyStatus::PENDING, 1, 1};
    emergency::EmergencyScheduler scheduler;
    scheduler.enqueue(low); scheduler.enqueue(criticalLater); scheduler.enqueue(criticalEarlier);
    require(scheduler.popNext()->id == "E1" && scheduler.popNext()->id == "E2" && scheduler.popNext()->id == "E3", "priority and deterministic timestamp ordering");
}
}

int main() { return runTests("structure_tests", tests); }
