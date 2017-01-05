angular.module("umbraco")
.controller("Umbraco.PropertyEditors.TagsController",
    function ($rootScope, $scope, $log, assetsService, umbRequestHelper, angularHelper, $timeout, $element, $sanitize) {

        var $typeahead;

        $scope.isLoading = true;
        $scope.tagToAdd = "";

        assetsService.loadJs("lib/typeahead.js/typeahead.bundle.min.js").then(function () {

            $scope.isLoading = false;

            //load current value
            initializeModelValue();

            // Method required by the valPropertyValidator directive (returns true if the property editor has at least one tag selected)
            $scope.validateMandatory = function () {
                return {
                    isValid: !$scope.model.validation.mandatory || ($scope.model.value != null && $scope.model.value.length > 0),
                    errorMsg: "Value cannot be empty",
                    errorKey: "required"
                };
            }

            //Helper method to add a tag on enter or on typeahead select
            function addTag(tagToAdd) {
                tagToAdd = String(tagToAdd).htmlEncode();
                if (tagToAdd != null && tagToAdd.length > 0) {
                    if ($scope.model.value.indexOf(tagToAdd) < 0) {
                        $scope.model.value.push(tagToAdd);
                        //this is required to re-validate
                        $scope.propertyForm.tagCount.$setViewValue($scope.model.value.length);
                    }
                }
            }

            $scope.addTagOnEnter = function (e) {
                var code = e.keyCode || e.which;
                if (code == 13) { //Enter keycode   
                    if ($element.find('.tags-' + $scope.model.alias).parent().find(".tt-menu .tt-cursor").length === 0) {
                        //this is required, otherwise the html form will attempt to submit.
                        e.preventDefault();
                        $scope.addTag();
                    }
                }
            };

            $scope.addTag = function () {
                //ensure that we're not pressing the enter key whilst selecting a typeahead value from the drop down
                //we need to use jquery because typeahead duplicates the text box
                addTag($scope.tagToAdd);
                $scope.tagToAdd = "";
                //this clears the value stored in typeahead so it doesn't try to add the text again
                // http://issues.umbraco.org/issue/U4-4947
                $typeahead.typeahead('val', '');
            };



            $scope.removeTag = function (tag) {
                var i = $scope.model.value.indexOf(tag);
                if (i >= 0) {
                    $scope.model.value.splice(i, 1);
                    //this is required to re-validate
                    $scope.propertyForm.tagCount.$setViewValue($scope.model.value.length);
                }
            };

            //vice versa
            $scope.model.onValueChanged = function (newVal, oldVal) {
                //update the display val again if it has changed from the server
                $scope.model.value = newVal;

                initializeModelValue();
            };

            function initializeModelValue() {
                if ($scope.model.value) {
                    if (!$scope.model.config.storageType || $scope.model.config.storageType !== "Json") {
                        //it is csv
                        if (!$scope.model.value) {
                            $scope.model.value = [];
                        }
                        else if (angular.isString($scope.model.value) && $scope.model.value.length > 0) {
                            $scope.model.value = $scope.model.value.split(",");
                        }
                    }
                    else if ($scope.model.config.storageType && $scope.model.config.storageType === "Json" && angular.isString($scope.model.value) && !$scope.model.value.detectIsJson()) {
                        //somehow data may be corrupted, in which case if the storage is json and the value is not empty and the
                        //value is not json, then we need to 'fix' it. maybe it was CSV and then converted to JSON
                        $scope.model.value = $scope.model.value.split(",");
                    }

                    //We must ensure that each item is Html Encoded and we must also ensure they are html encoded the same way, 
                    // for example, if we html encode them on the server before being sent here the encoding will vary slightly because ASP.NET
                    // and JQuery encoding operate slightly differently depending on the chars, so we need to html encode here
                    $scope.model.value = _.map($scope.model.value, function (i) {
                        return i.htmlEncode();
                    });
                }
                else {
                    $scope.model.value = [];
                }
            }

            //configure the tags data source

            //helper method to format the data for bloodhound
            function dataTransform(list) {
                //transform the result to what bloodhound wants
                var tagList = _.map(list, function (i) {
                    return { value: i.text };
                });
                // remove current tags from the list
                return $.grep(tagList, function (tag) {
                    return ($.inArray(tag.value, $scope.model.value) === -1);
                });
            }

            // helper method to remove current tags
            function removeCurrentTagsFromSuggestions(suggestions) {
                return $.grep(suggestions, function (suggestion) {
                    return ($.inArray(suggestion.value.htmlEncode(), $scope.model.value) === -1);
                });
            }

            var tagsHound = new Bloodhound({
                datumTokenizer: Bloodhound.tokenizers.obj.whitespace('value'),
                queryTokenizer: Bloodhound.tokenizers.whitespace,
                dupDetector : function(remoteMatch, localMatch) {
                    return (remoteMatch["value"] == localMatch["value"]);
                },
                //pre-fetch the tags for this category
                prefetch: {
                    url: umbRequestHelper.getApiUrl("tagsDataBaseUrl", "GetTags", [{ tagGroup: $scope.model.config.group }]),
                    //TTL = 5 minutes
                    ttl: 300000,
                    filter: dataTransform
                },
                //dynamically get the tags for this category (they may have changed on the server)
                remote: {
                    url: umbRequestHelper.getApiUrl("tagsDataBaseUrl", "GetTags", [{ tagGroup: $scope.model.config.group }]),
                    filter: dataTransform
                }
            });

            tagsHound.initialize(true);

            //configure the type ahead
            $timeout(function () {

                var thElement = $element.find('.tags-' + $scope.model.alias);

                $typeahead = thElement.typeahead(
                {
                    //This causes some strangeness as it duplicates the textbox, best leave off for now.
                    hint: false,
                    highlight: true,
                    cacheKey: new Date(),  // Force a cache refresh each time the control is initialized
                    minLength: 1
                }, {
                    //see: https://github.com/twitter/typeahead.js/blob/master/doc/jquery_typeahead.md#options
                    // name = the data set name, we'll make this the tag group name
                    name: $scope.model.config.group,
                    display: "value",
                    //source: tagsHound
                    source: function (query, syncResults, asyncResults) {
                        tagsHound.search(query,
                            function(suggestions) {
                                syncResults(removeCurrentTagsFromSuggestions(suggestions));
                            },
                            function(suggestions) {
                                asyncResults(removeCurrentTagsFromSuggestions(suggestions));
                            });
                    }
                });

                thElement.bind("typeahead:select", function (ev, suggestion) {
                    console.log('typeahead:select: ' + suggestion);
                    angularHelper.safeApply($scope, function () {
                        addTag(suggestion.value);
                        $scope.tagToAdd = "";
                        // clear the typed text
                        $typeahead.typeahead('val', '');
                    });

                }).bind("typeahead:autocomplete", function (ev, suggestion) {
                    console.log('typeahead:autocomplete: ' + suggestion);
                    angularHelper.safeApply($scope, function () {
                        addTag(suggestion.value);
                        $scope.tagToAdd = "";
                    });
                });
            });

            $scope.$on('$destroy', function () {
                tagsHound.clearPrefetchCache();
                tagsHound.clearRemoteCache();
                $element.find('.tags-' + $scope.model.alias).typeahead('destroy');
                delete tagsHound;
            });

        });

    }
);