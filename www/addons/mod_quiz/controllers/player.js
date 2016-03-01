// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_quiz')

/**
 * Quiz player controller.
 *
 * @module mm.addons.mod_quiz
 * @ngdoc controller
 * @name mmaModQuizPlayerCtrl
 */
.controller('mmaModQuizPlayerCtrl', function($log, $scope, $stateParams, $mmaModQuiz, $mmaModQuizHelper, $q, $mmUtil,
            $ionicPopover, $ionicScrollDelegate, $rootScope, $ionicPlatform, $translate, $timeout) {
    $log = $log.getInstance('mmaModQuizPlayerCtrl');

    var quizId = $stateParams.quizid,
        courseId = $stateParams.courseid,
        moduleUrl = $stateParams.moduleurl,
        quiz,
        accessInfo,
        attempt,
        newAttempt,
        originalBackFunction = $rootScope.$ionicGoBack,
        unregisterHardwareBack,
        leaving = false;

    $scope.moduleUrl = moduleUrl;
    $scope.quizAborted = false;
    $scope.answers = {};
    $scope.preflightData = {};

    // Convenience function to start the player.
    function start(preflightData) {
        var promise;
        $scope.dataLoaded = false;

        if (typeof password != 'undefined') {
            // Password submitted, get attempt data.
            promise = startOrContinueAttempt(preflightData);
        } else {
            // Fetch data.
            promise = fetchData().then(function() {
                return startOrContinueAttempt(preflightData);
            });
        }

        promise.finally(function() {
            $scope.dataLoaded = true;
        });
    }

    // Convenience function to get the quiz data.
    function fetchData() {
        return $mmaModQuiz.getQuizById(courseId, quizId).then(function(quizData) {
            quiz = quizData;
            quiz.isSequential = $mmaModQuiz.isNavigationSequential(quiz);

            if (quiz.timelimit > 0) {
                $scope.isTimed = true;
                $mmUtil.formatTime(quiz.timelimit).then(function(time) {
                    quiz.readableTimeLimit = time;
                });
            }

            $scope.quiz = quiz;

            // Get access information for the quiz.
            return $mmaModQuiz.getAccessInformation(quiz.id, 0, true).then(function(info) {
                accessInfo = info;
                $scope.requirePassword = accessInfo.ispreflightcheckrequired;

                // Get attempts to determine last attempt.
                return $mmaModQuiz.getUserAttempts(quiz.id, 'all', true, true).then(function(attempts) {
                    if (!attempts.length) {
                        newAttempt = true;
                    } else {
                        attempt = attempts[attempts.length - 1];
                        newAttempt = $mmaModQuiz.isAttemptFinished(attempt.state);
                    }
                });
            });
        }).catch(function(message) {
            return $mmaModQuizHelper.showError(message);
        });
    }

    // Convenience function to start/continue the attempt.
    function startOrContinueAttempt(preflightData) {
        // Check preflight data and start attempt if needed.
        var atmpt = newAttempt ? undefined : attempt;
        return $mmaModQuizHelper.checkPreflightData($scope, quiz.id, accessInfo, atmpt, preflightData).then(function(att) {
            attempt = att;
            $scope.attempt = attempt;
            $scope.toc = $mmaModQuiz.getTocFromLayout(attempt.layout);

            return loadPage(attempt.currentpage).catch(function(message) {
                return $mmaModQuizHelper.showError(message, 'mm.core.error');
            });
        });
    }

    // Load a page questions.
    function loadPage(page) {
        return $mmaModQuiz.getAttemptData(attempt.id, page, $scope.preflightData, true).then(function(data) {
            // Remove all answers stored since each page has its own questions.
            $mmUtil.emptyObject($scope.answers);

            $scope.questions = data.questions;
            attempt.currentpage = page;
            $scope.nextPage = data.nextpage;
            $scope.previousPage = quiz.isSequential ? -1 : page - 1;
            $scope.showSummary = false;

            angular.forEach($scope.questions, function(question) {
                // Get the readable mark for each question.
                question.readableMark = $mmaModQuizHelper.getQuestionMarkFromHtml(question.html);
                // Remove the question info box so it's not in the question HTML anymore.
                question.html = $mmUtil.removeElementFromHtml(question.html, '.info');
            });

            // Mark the page as viewed. We'll ignore errors in this call.
            $mmaModQuiz.logViewAttempt(attempt.id, page);
        });
    }

    // Load attempt summary.
    function loadSummary() {
        $scope.showSummary = true;
        $scope.summaryQuestions = [];
        return $mmaModQuiz.getAttemptSummary(attempt.id, $scope.preflightData, true).then(function(questions) {
            $scope.summaryQuestions = questions;

            // Log summary as viewed.
            $mmaModQuiz.logViewAttemptSummary(attempt.id);
        }).catch(function(message) {
            $scope.showSummary = false;
            return $mmaModQuizHelper.showError(message, 'mma.mod_quiz.errorgetquestions');
        });
    }

    // Function called when the user wants to leave the player. Save the attempt before leaving.
    function leavePlayer() {
        if (leaving) {
            return;
        }

        leaving = true;
        var promise,
            modal = $mmUtil.showModalLoading('mm.core.sending', true);

        if ($scope.questions && $scope.questions.length && !$scope.showSummary) {
            // Save answers.
            promise = $mmaModQuiz.processAttempt(attempt.id, $scope.answers, false, false);
        } else {
            // Nothing to save.
            promise = $q.when();
        }

        promise.catch(function() {
            // Save attempt failed. Show confirmation.
            modal.dismiss();
            return $mmUtil.showConfirm($translate('mma.mod_quiz.confirmleavequizonerror'));
        }).then(function() {
            // Attempt data successfully saved or user confirmed to leave. Leave player.
            modal.dismiss();
            originalBackFunction();
        }).finally(function() {
            leaving = false;
        });
    }

    // Override Ionic's back button behavior.
    $rootScope.$ionicGoBack = leavePlayer;

    // Override Android's back button. We set a priority of 101 to override the "Return to previous view" action.
    unregisterHardwareBack = $ionicPlatform.registerBackButtonAction(leavePlayer, 101);

    // Start the player when the controller is loaded.
    start();

    // Start the player.
    $scope.start = function(preflightData) {
        start(preflightData);
    };

    // Function to call to abort the quiz.
    $scope.abortQuiz = function() {
        $scope.quizAborted = true;
    };

    // Load a certain page.
    $scope.loadPage = function(page, fromToc, question) {
        if ((page == attempt.currentpage && !$scope.showSummary) || (fromToc && quiz.isSequential && page != -1)) {
            // If the user is navigating to the current page we do nothing.
            // Also, in sequential quizzes we don't allow navigating using the TOC except for finishing the quiz (summary).
            return;
        } else if (page === -1 && $scope.showSummary) {
            // Summary already shown.
            return;
        }

        var promise;

        $scope.dataLoaded = false;
        $ionicScrollDelegate.scrollTop();
        $scope.popover.hide(); // Hide popover if shown.

        // First try to save the attempt data. We only save it if we're not seeing the summary.
        promise = $scope.showSummary ? $q.when() : $mmaModQuiz.processAttempt(attempt.id, $scope.answers, false, false);
        promise.catch(function(message) {
            return $mmaModQuizHelper.showError(message, 'mma.mod_quiz.errorsaveattempt');
        }).then(function() {
            // Attempt data successfully saved, load the page or summary.
            if (page === -1) {
                return loadSummary();
            } else {
                return loadPage(page).catch(function(message) {
                    return $mmaModQuizHelper.showError(message, 'mma.mod_quiz.errorgetquestions');
                });
            }
        }).finally(function() {
            $scope.dataLoaded = true;
            $ionicScrollDelegate.resize(); // Call resize to recalculate scroll area.

            if (question) {
                // Scroll to the question. Give some time to the questions to render.
                $timeout(function() {
                    $mmUtil.scrollToElement(document, '#mma-mod_quiz-question-' + question);
                }, 2000);
            }
        });
    };

    // Setup TOC popover.
    $ionicPopover.fromTemplateUrl('addons/mod_quiz/templates/toc.html', {
        scope: $scope,
    }).then(function(popover) {
        $scope.popover = popover;
    });

    $scope.$on('$destroy', function() {
        // Restore original back functions.
        unregisterHardwareBack();
        $rootScope.$ionicGoBack = originalBackFunction;
    });
});
