/// <reference path="../../../framework.d.ts" />
(function () {
    'use strict';

    const content = window.framework.findContentDiv();
    (<HTMLElement>content.querySelector('.notification-bar')).style.display = 'none';

    const mdFileUrl: string = window.framework.getContentLocation() === '/' ? '../../../docs/PTMeetingsAnonJoinOnline.md' : 'Content/websdk/docs/PTMeetingsAnonJoinOnline.md';
    content.querySelector('zero-md').setAttribute('file', mdFileUrl);

    var app;
    var conversation;
    var listeners = [];
    const remoteVidContainerMap: { [displayName: string]: HTMLElement } = {};

    var discoverUrl = "";
    var authToken = "";
    var meetingUrl = "";

    window.framework.bindInputToEnter(<HTMLInputElement>content.querySelector('.anon_name'));

    function cleanUI() {
        (<HTMLInputElement>content.querySelector('.anon_name')).value = '';
        (<HTMLElement>content.querySelector('.selfVideoContainer')).innerHTML = '';
        (<HTMLElement>content.querySelector('.remoteVideoContainer')).innerHTML = '';
        (<HTMLElement>content.querySelector('#selfvideo')).style.display = 'none';
        (<HTMLElement>content.querySelector('#remotevideo')).style.display = 'none';
        (<HTMLInputElement>content.querySelector('.join')).disabled = false;
    }

    function cleanupConversation() {
        if (conversation && conversation.state() !== 'Disconnected') {
            conversation.leave().then(() => {
                conversation = null;
            });
        } else {
            conversation = null;
        }
    }

    function reset(bySample: Boolean) {
        window.framework.hideNotificationBar();
        content.querySelector('.notification-bar').innerHTML = '<br/> <div class="mui--text-subhead"><b>Events Timeline</b></div> <br/>';

        meetingUrl = "";
        discoverUrl = "";
        authToken = "";

        // remove remote video containers and reset mapping
        const containerParentElt = document.getElementById('remoteVideoContainers');
        Object.keys(remoteVidContainerMap).forEach(participantId => {
            containerParentElt.removeChild(remoteVidContainerMap[participantId]);
            delete remoteVidContainerMap[participantId];
        })

        // remove any outstanding event listeners
        for (var i = 0; i < listeners.length; i++) {
            listeners[i].dispose();
        }
        listeners = [];

        if (conversation) {
            if (bySample) {
                cleanupConversation();
                cleanUI();
            } else {
                const result = window.confirm('Leaving this sample will end the conversation.  Do you really want to leave?');
                if (result) {
                    cleanupConversation();
                    cleanUI();
                    restart();
                }

                return result;
            }
        } else {
            cleanUI();
        }
        if (app.signInManager.state() == 'SignedIn') {
            app.signInManager.signOut();
            window.framework.addNotification('info', 'Signed out of anonymous conference');
        }
    }

    function restart() {
        goToStep(1);
        (<HTMLElement>content.querySelector('#selfvideo')).style.display = 'none';
        (<HTMLElement>content.querySelector('#remotevideo')).style.display = 'none';
        (<HTMLInputElement>content.querySelector('.join')).disabled = false;
        (<HTMLInputElement>content.querySelector('.getToken')).disabled = false;
    }

    function joinMeeting () {
        if (!(<HTMLInputElement>content.querySelector('.anon_name')).value) {
            window.framework.addNotification('info', 'Please enter a name to use ' + 
                'for joining the meeting anonymously');
            return;
        }

        (<HTMLInputElement>content.querySelector('.join')).disabled = true;
        const name = (<HTMLInputElement>content.querySelector('.anon_name')).value;
        const conversationsManager = app.conversationsManager;

        window.framework.addNotification('info', 'Attempting to join conference anonymously');
        
        app.signInManager.signIn({
            name: name,
            cors: true,
            root: { user: discoverUrl },
            auth: function (req, send) {
                // Send token with all requests except for the GET /discover
                if (req.url != discoverUrl)
                    req.headers['Authorization'] = authToken;
                
                return send(req);
            }
        }).then(() => {
            // When joining a conference anonymously, sdk automatically creates
            // a conversation object to represent the conference being joined
            conversation = conversationsManager.conversations(0);
            window.framework.addNotification('success',
                'Successfully signed in with anonymous online meeting token');
            setUpListeners();
            startVideoService();
        }).catch(err => {
            window.framework.addNotification('error',
                'Unable to join conference anonymously: ' + err);
        });

        function setupContainer(videoChannel: jCafe.VideoChannel, videoDiv: HTMLElement) {
            videoChannel.stream.source.sink.format('Stretch');
            videoChannel.stream.source.sink.container(videoDiv);
        }

        function createVideoContainer () {
            var containersDiv = content.querySelector('.remoteVideoContainers');
            var newContainer = document.createElement('div');
            newContainer.className = 'remoteVideoContainer';
            containersDiv.appendChild(newContainer);
            return newContainer;
        }

        function createAndSetUpContainer(participant: jCafe.Participant) {
            var container = remoteVidContainerMap[participant.person.displayName()] || createVideoContainer();
            remoteVidContainerMap[participant.person.displayName()] = container;
            setupContainer(participant.video.channels(0), container);
        }

        function disposeParticipantContainer(participant: jCafe.Participant) {
            const container = remoteVidContainerMap[participant.person.displayName()];
            if (container) {
                var containerParentElt = document.getElementById('remoteVideoContainers');
                containerParentElt.removeChild(container);
                delete remoteVidContainerMap[participant.person.displayName()];
            }
        }

        function handleIsVideoOnChangedMV(newState: boolean, oldState: boolean, participant: jCafe.Participant) {
            const nRemoteVids = conversation.participants().filter(p => p.video.channels(0).isVideoOn() == true).length;       
            (<HTMLElement>content.querySelector('#remotevideo')).style.display = 
                nRemoteVids > 0 ? 'block' : 'none';

            const msg = newState ? ' started streaming their video' : ' stopped streaming their video';
            window.framework.addNotification('info', participant.person.displayName() + msg);
            participant.video.channels(0).isStarted(newState);
        }

        function handleParticipantVideoStateChanged(newState: string, oldState: string, participant: jCafe.Participant) {
            if (newState == "Connected") {
                createAndSetUpContainer(participant);
                window.framework.addNotification('info', participant.person.displayName() + ' is connected to video');                                                       
                listeners.push(participant.video.channels(0).isVideoOn.changed((newState, reason, oldState) => {
                    handleIsVideoOnChangedMV(newState, oldState, participant);
                }));
            } else if (newState == "Disconnected" && oldState == "Connected") {
                disposeParticipantContainer(participant);
                window.framework.addNotification('info', participant.person.displayName() + ' has disconnected their video');                           
            }
        }

        function handleIsVideoOnChangedAS(newState: boolean, activeSpeaker: jCafe.ActiveSpeaker) {
            (<HTMLElement>content.querySelector('#remotevideo')).style.display = newState ? 'block': 'none';
            window.framework.addNotification('info', 'ActiveSpeaker video channel isVideoOn == ' + newState);
            activeSpeaker.channel.isStarted(newState);
        }

        function handleConversationStateChanged(newState: string, reason: any, oldState: string) {
            if (newState === 'Disconnected' && (oldState === 'Connected' || oldState === 'Connecting')) {
                window.framework.addNotification('success', 'Conversation ended');
                (<HTMLElement>content.querySelector('#selfvideo')).style.display = 'none';
                (<HTMLElement>content.querySelector('#remotevideo')).style.display = 'none';
                goToStep(4);
                reset(true);
            } else if (newState == 'Connected')
                window.framework.addNotification('success', 'Conversation connected');
        }

        function setUpListeners () {
            listeners.push(conversation.selfParticipant.video.state.when('Connected', () => {
                window.framework.addNotification('info', 'Showing self video...');
                (<HTMLElement>content.querySelector('#selfvideo')).style.display = 'block';
                setupContainer(conversation.selfParticipant.video.channels(0), <HTMLElement>content.querySelector('.selfVideoContainer'));
                window.framework.addNotification('success', 'Connected to video');

                // In multiview, listen for added participants, set up a container for each,
                // set up listeners to call isStarted(true/false) when isVideoOn() becomes true/false
                if (conversation.videoService.videoMode() == 'MultiView') {
                    listeners.push(conversation.participants.added(participant => {
                        window.framework.addNotification('success', participant.person.displayName() + ' has joined the conversation');
                        listeners.push(participant.video.state.changed((newState, reason, oldState) => {
                            handleParticipantVideoStateChanged(newState, oldState, participant)
                        }));
                    }));
                    listeners.push(conversation.participants.removed(participant => {
                        disposeParticipantContainer(participant);
                        window.framework.addNotification('success', participant.person.displayName() + ' has left the conversation');
                    }))
                } 
                // In activeSpeaker mode, set up one container for activeSpeaker channel, and call
                // isStarted(true/false) when channel.isVideoOn() becomes true/false
                else if(conversation.videoService.videoMode() == 'ActiveSpeaker') {
                    var activeSpeaker = conversation.videoService.activeSpeaker;
                    setupContainer(activeSpeaker.channel, createVideoContainer());
                    listeners.push(activeSpeaker.channel.isVideoOn.changed(newState => {
                        handleIsVideoOnChangedAS(newState, activeSpeaker)
                    }));
                    listeners.push(activeSpeaker.participant.changed(p => {
                        window.framework.addNotification('info', 'ActiveSpeaker has changed to: ' + p.person.displayName());                            
                    }));
                } 
            }));

            listeners.push(conversation.state.changed((newState, reason, oldState) => {
                handleConversationStateChanged(newState, reason, oldState);
            }));
        }

        function startVideoService () {
            conversation.videoService.start().then(null, error => {
                window.framework.addNotification('error', error);
                if (error.code && error.code == 'PluginNotInstalled') {
                    window.framework.addNotification('info', 'You can install the plugin from:');
                    window.framework.addNotification('info', '(Windows) https://swx.cdn.skype.com/s4b-plugin/16.2.0.67/SkypeMeetingsApp.msi');
                    window.framework.addNotification('info', '(Mac) https://swx.cdn.skype.com/s4b-plugin/16.2.0.67/SkypeForBusinessPlugin.pkg');
                }
            });
            goToStep(3);
        }
    }
    
    function endConversation () {
        window.framework.addNotification('info', 'Ending conversation...');
        if (!conversation) {
            reset(true);
            restart();
            return;
        }
        conversation.leave().then(() => {
            window.framework.addNotification('success', 'Conversation ended');
            goToStep(4);
        }, error => {
            window.framework.addNotification('error', error);
        }).then(() => {
            reset(true);
        });
    }

    if (window.framework.application && window.framework.application.signInManager.state() == 'SignedIn') {
        if (confirm('You must sign out of your existing session to anonymously join ' +
                    'a meeting. Sign out now?'))
            window.framework.application.signInManager.signOut();
        else {
            window.framework.addNotification('error', 'Must refresh the page or allow sign ' +
                'out in order to use this sample.');
            goToStep(4);
        }
    }

    app = window.framework.api.UIApplicationInstance;

    window.framework.registerNavigation(reset);

    window.framework.addEventListener(content.querySelector('.join'), 'click', joinMeeting);    
    window.framework.addEventListener(content.querySelector('.end'), 'click', endConversation);
    window.framework.addEventListener(content.querySelector('.restart'), 'click', restart);
    window.framework.addEventListener(content.querySelector('.getToken'), 'click', getToken);

    function getToken() {
        window.framework.showNotificationBar();
        if (!(<HTMLInputElement>content.querySelector('.meeting_url')).value) {
            window.framework.addNotification('info', 'Please enter a meeting_url to get an anonymous token for');
            return;
        }

        (<HTMLInputElement>content.querySelector('.getToken')).disabled = true;
        meetingUrl = (<HTMLInputElement>content.querySelector('.meeting_url')).value;

        var allowedOrigins = window.location.href;
        var serviceUrl = "http://webrtctest.cloudapp.net";

        var request = new XMLHttpRequest();
        request.onreadystatechange = function () {
            if (request.readyState === XMLHttpRequest.DONE) {
                if (request.status === 200) {
                    window.console.log(request.responseText);
                    window.framework.addNotification('success', 'Successfully got anonymous auth token');

                    var response = JSON.parse(request.response);
                    discoverUrl = response.DiscoverUri;
                    authToken = "Bearer " + response.Token;

                    goToStep(2);
                } else {
                    window.framework.addNotification('error', 'Unable to fetch anon token: ' +
                        request.responseText);
                }
            }
        };

        var data = "ApplicationSessionId=" + window.framework.utils.guid() +
            "&AllowedOrigins=" + encodeURIComponent(allowedOrigins) +
            "&MeetingUrl=" + encodeURIComponent(meetingUrl);

        request.open('post', serviceUrl + "/getAnonTokenJob");
        request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        request.send(data);
    }



    function goToStep(step) {
        (<HTMLElement>content.querySelector('#step1')).style.display = 'none';
        (<HTMLElement>content.querySelector('#step2')).style.display = 'none';
        (<HTMLElement>content.querySelector('#step3')).style.display = 'none';
        (<HTMLElement>content.querySelector('#step4')).style.display = 'none';
        (<HTMLElement>content.querySelector('#step' + step)).style.display = 'block';
    }

})();