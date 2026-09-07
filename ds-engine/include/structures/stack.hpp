#pragma once

#include <cstddef>
#include <optional>
#include <utility>

namespace emergency {

// LIFO stack for route revisions, with newest revision at the top.
template <typename T>
class Stack {
public:
    Stack() = default;
    Stack(const Stack& other) { copyFrom(other); }
    Stack& operator=(const Stack& other) { if (this != &other) { while (pop().has_value()) {} copyFrom(other); } return *this; }
    ~Stack() { while (pop().has_value()) {} }
    void push(const T& value) { top_ = new Node(value, top_); ++size_; }
    void push(T&& value) { top_ = new Node(std::move(value), top_); ++size_; }
    [[nodiscard]] std::optional<T> pop() { if (!top_) return std::nullopt; Node* old = top_; T value = std::move(old->value); top_ = old->next; delete old; --size_; return value; }
    [[nodiscard]] T* peek() { return top_ ? &top_->value : nullptr; }
    [[nodiscard]] const T* peek() const { return top_ ? &top_->value : nullptr; }
    [[nodiscard]] bool empty() const { return size_ == 0; }
    [[nodiscard]] std::size_t size() const { return size_; }
private:
    struct Node { T value; Node* next; Node(const T& v, Node* n) : value(v), next(n) {} Node(T&& v, Node* n) : value(std::move(v)), next(n) {} };
    Node* top_{nullptr}; std::size_t size_{};
    void copyFrom(const Stack& other) { if (!other.top_) return; copyNodes(other.top_); }
    void copyNodes(const Node* node) { if (!node) return; copyNodes(node->next); push(node->value); }
};

}  // namespace emergency
