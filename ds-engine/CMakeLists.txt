cmake_minimum_required(VERSION 3.20)
project(smart_emergency_ds_engine VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(emergency_engine
    src/graph/city_graph.cpp
    src/graph/dijkstra.cpp
    src/services/resource_allocator.cpp
    src/services/route_planner.cpp
    src/engine/emergency_engine.cpp
)
target_include_directories(emergency_engine PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
if (MSVC)
  target_compile_options(emergency_engine PRIVATE /W4)
else()
  target_compile_options(emergency_engine PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(engine_console apps/console_simulator.cpp)
target_link_libraries(engine_console PRIVATE emergency_engine)

enable_testing()
foreach(test_target IN ITEMS structure_tests graph_tests engine_tests)
  add_executable(${test_target} tests/${test_target}.cpp)
  target_link_libraries(${test_target} PRIVATE emergency_engine)
  add_test(NAME ${test_target} COMMAND ${test_target})
endforeach()
